package com.vowkey.app.ui.platform.feature.settings.agents

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.data.vault.repository.util.isVowkeyMetadata
import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.model.toVowkeyError
import com.vowkey.network.model.VowkeyError
import com.vowkey.network.util.toResult
import com.vowkey.vault.CipherListViewType
import com.vowkey.vault.Folder
import com.vowkey.vault.FolderView
import dagger.hilt.android.lifecycle.HiltViewModel
import java.time.Instant
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

internal fun JsonObject.text(key: String): String = getValue(key).jsonPrimitive.content
internal fun JsonObject.optionalText(key: String): String? = get(key)?.jsonPrimitive?.contentOrNull
internal fun JsonObject.rows(key: String): List<JsonObject> =
    getValue(key).jsonArray.map { it.jsonObject }

internal data class AgentEntry(
    val id: String,
    val cipherId: String,
    val fieldPath: String,
    val sectionId: String,
    val label: String,
    val profileId: String?,
)

internal data class AgentRequest(
    val row: JsonObject,
    val routing: JsonObject,
    val note: JsonObject?,
    val agentName: String,
    val entries: List<AgentEntry>,
    val sections: List<Pair<String, String>>,
    val selected: Set<String>,
    val profiles: Map<String, String>,
    val answer: String?,
) {
    val id: String get() = row.text("requestId")
    val pending: Boolean get() = row.text("status") == "pending" && answer == null &&
        Instant.parse(row.text("deadline")).isAfter(Instant.now())
}

internal data class AgentRecord(val row: JsonObject, val payload: JsonObject)
internal data class AgentsState(
    val loading: Boolean = true,
    val busy: Boolean = false,
    val locked: Boolean = false,
    val error: AgentsError? = null,
    val requests: List<AgentRequest> = emptyList(),
    val pairings: List<AgentRecord> = emptyList(),
    val grants: List<AgentRecord> = emptyList(),
    val profiles: List<Pair<String, String>> = emptyList(),
)
internal enum class AgentsError { LOAD, SAVE, RESOLVED, EXPIRED, INVALID_SELECTION }

/** Phones submit answers to the server CAS; this owner has no fill or result-writing API. */
@HiltViewModel
internal class AgentsViewModel @Inject constructor(
    private val auth: AuthRepository,
    private val vault: VaultRepository,
    private val sdk: VaultSdkSource,
    client: VowkeyServiceClient,
) : ViewModel() {
    private val api = client.agentApi
    private val json = Json { ignoreUnknownKeys = true }
    private val mutableState = MutableStateFlow(AgentsState())
    val state = mutableState.asStateFlow()
    private var operation: Job? = null
    private var scopeUserId: String? = null

    init {
        viewModelScope.launch {
            combine(auth.userStateFlow, vault.vaultUnlockDataStateFlow) { user, _ ->
                user?.activeAccount?.userId?.takeIf { vault.isVaultUnlocked(it) }
            }.collect { userId ->
                if (userId != scopeUserId || mutableState.value.loading) {
                    operation?.cancel()
                    scopeUserId = userId
                    mutableState.value = AgentsState(loading = false, locked = userId == null)
                    if (userId != null) refresh()
                }
            }
        }
    }

    fun refresh() = runOperation(AgentsError.LOAD) { userId -> load(userId) }

    fun select(requestId: String, entryId: String, selected: Boolean) {
        mutableState.value = mutableState.value.copy(requests = mutableState.value.requests.map {
            if (it.id != requestId) it else it.copy(selected =
                if (selected) it.selected + entryId else it.selected - entryId)
        })
    }

    fun selectProfile(requestId: String, sectionId: String, profileId: String) {
        mutableState.value = mutableState.value.copy(requests = mutableState.value.requests.map {
            if (it.id != requestId) it else it.copy(profiles = it.profiles + (sectionId to profileId))
        })
    }

    fun answer(requestId: String, choice: String) = runOperation(AgentsError.SAVE) { userId ->
        val request = mutableState.value.requests.first { it.id == requestId }
        require(choice in setOf("allow_once", "always_allow", "deny"))
        if (!request.pending) {
            mutableState.value = mutableState.value.copy(error = AgentsError.EXPIRED)
            load(userId, AgentsError.EXPIRED)
            return@runOperation
        }
        val selected = if (choice == "deny") emptySet() else request.selected
        val profileIds = mutableState.value.profiles.map { it.first }.toSet()
        if (choice != "deny" && (selected.isEmpty() || request.entries
                .filter { it.id in selected }
                .any { entry ->
                    val choices = request.entries.filter { it.sectionId == entry.sectionId }
                    val needsChoice = choices.mapNotNull { it.profileId }.distinct().size > 1 ||
                        choices.any { it.profileId == null && it.fieldPath.startsWith("detail.") }
                    val profile = request.profiles[entry.sectionId]
                    needsChoice && (profile !in profileIds ||
                        (entry.profileId != null && entry.profileId != profile))
                })) {
            mutableState.value = mutableState.value.copy(error = AgentsError.INVALID_SELECTION)
            return@runOperation
        }
        val payload = buildJsonObject {
            put("v", 1)
            put("requestId", request.id)
            put("answer", choice)
            put("selectedEntryIds", JsonArray(selected.map(::JsonPrimitive)))
            put("sectionProfiles", buildJsonObject {
                if (choice != "deny") request.profiles.forEach { (section, profile) ->
                    require(section in request.sections.map { it.first } && profile in profileIds)
                    put(section, profile)
                }
            })
            put("answeredAt", Instant.now().toString())
        }
        val encrypted = encrypt(userId, payload)
        ensureScope(userId)
        val result = api.answer(request.id, buildJsonObject {
            put("revision", request.row.getValue("answerRevision"))
            put("answer", encrypted)
        }).toResult()
        val failure = result.exceptionOrNull()
        if (failure != null) {
            val http = failure.toVowkeyError() as? VowkeyError.Http
            val conflict = http?.takeIf { it.code == 409 }?.responseBodyString?.let {
                json.parseToJsonElement(it).jsonObject
            }
            if (conflict != null) {
                val error = if (conflict.optionalText("code") == "deadline_passed")
                    AgentsError.EXPIRED else AgentsError.RESOLVED
                // Re-read the winning ciphertext and authoritative status rather than claiming a fill.
                load(userId, error)
                return@runOperation
            }
            throw failure
        }
        load(userId)
    }

    fun revokePairing(id: String) = runOperation(AgentsError.SAVE) { userId ->
        val row = mutableState.value.pairings.first { it.row.text("pairingId") == id }.row
        ensureScope(userId)
        api.updatePairing(id, buildJsonObject {
            put("revision", row.getValue("revision"))
            put("revokedAt", Instant.now().toString())
        }).toResult().getOrThrow()
        load(userId)
    }

    fun revokeGrant(id: String) = runOperation(AgentsError.SAVE) { userId ->
        val grant = mutableState.value.grants.first { it.row.text("grantId") == id }
        val revokedAt = Instant.now().toString()
        val encrypted = encrypt(userId, JsonObject(grant.payload +
            ("revokedAt" to JsonPrimitive(revokedAt))))
        ensureScope(userId)
        api.updateGrant(id, buildJsonObject {
            put("revision", grant.row.getValue("revision"))
            put("encryptedGrant", encrypted)
            put("revokedAt", revokedAt)
        }).toResult().getOrThrow()
        load(userId)
    }

    private fun runOperation(error: AgentsError, block: suspend (String) -> Unit) {
        val userId = scopeUserId ?: return
        if (mutableState.value.busy) return
        operation = viewModelScope.launch {
            mutableState.value = mutableState.value.copy(busy = true, error = null)
            try {
                ensureScope(userId)
                block(userId)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                if (scopeUserId == userId) mutableState.value = mutableState.value.copy(error = error)
            } finally {
                if (scopeUserId == userId) mutableState.value = mutableState.value.copy(
                    loading = false, busy = false,
                )
            }
        }
    }

    private suspend fun load(userId: String, message: AgentsError? = null) {
        ensureScope(userId)
        val sync = api.sync().toResult().getOrThrow()
        val pairings = sync.rows("pairings").map { row ->
            val payload = decrypt(userId, row.text("encryptedMetadata"))
            require(payload.text("pairingId") == row.text("pairingId"))
            AgentRecord(row, payload)
        }
        val profiles = vault.decryptCipherListResultStateFlow.first { it.data != null }.data
            ?.successes.orEmpty().filter { it.type == CipherListViewType.Identity &&
                it.deletedDate == null && it.archivedDate == null }
            .mapNotNull { item ->
                val cipher = vault.getVaultItemStateFlow(requireNotNull(item.id))
                    .first { it.data != null }.data ?: return@mapNotNull null
                val metadata = cipher.fields?.firstOrNull { it.isVowkeyMetadata }?.value?.let {
                    json.parseToJsonElement(it).jsonObject
                }
                if (metadata == null || metadata["v"]?.jsonPrimitive?.intOrNull != 1 ||
                    metadata.optionalText("status") != "confirmed" ||
                    metadata["details"] !is JsonArray || metadata["sources"] !is JsonArray) null
                else requireNotNull(item.id) to item.name
            }
        val requests = sync.rows("requests").map { row ->
            val id = row.text("requestId")
            val routing = decrypt(userId, row.text("routing"), id)
            require(routing.text("pairingId") == row.text("pairingId"))
            val sections = routing.rows("sections").map { it.text("id") to it.text("label") }
            require(sections.map { it.first }.distinct().size == sections.size)
            val entries = routing.rows("entries").map {
                AgentEntry(it.text("entryId"), it.text("cipherId"), it.text("fieldPath"),
                    it.text("sectionId"), it.text("label"), it.optionalText("profileId"))
            }
            require(entries.map { it.id }.distinct().size == entries.size &&
                entries.all { it.sectionId in sections.map { section -> section.first } })
            val answer = row.optionalText("answer")?.let { decrypt(userId, it, id).text("answer") }
            val note = row.optionalText("note")?.takeIf { answer == null &&
                row.text("status") == "pending" && Instant.parse(row.text("deadline")).isAfter(Instant.now()) }
                ?.let { decrypt(userId, it, id) }
            AgentRequest(row, routing, note,
                pairings.firstOrNull { it.row.text("pairingId") == row.text("pairingId") }
                    ?.payload?.text("displayName") ?: row.text("pairingId"),
                entries, sections, entries.map { it.id }.toSet(), emptyMap(), answer)
        }
        val grants = sync.rows("grants").filter { it.optionalText("revokedAt") == null }.map { row ->
            val payload = decrypt(userId, row.text("encryptedGrant"))
            require(payload.text("cipherId") == row.text("sourceCipherId"))
            AgentRecord(row, payload)
        }
        ensureScope(userId)
        mutableState.value = AgentsState(loading = false, busy = true, error = message,
            requests = requests, pairings = pairings.filter { it.row.optionalText("revokedAt") == null },
            grants = grants, profiles = profiles)
    }

    private fun ensureScope(userId: String) {
        check(scopeUserId == userId && auth.userStateFlow.value?.activeAccount?.userId == userId &&
            vault.isVaultUnlocked(userId))
    }

    // The existing folder-name primitive is a legacy user-key EncString, not a saved folder.
    private suspend fun encrypt(userId: String, payload: JsonObject): String {
        ensureScope(userId)
        return sdk.encryptFolder(userId, FolderView(null, payload.toString(), Instant.EPOCH))
            .getOrThrow().name
    }

    private suspend fun decrypt(userId: String, ciphertext: String, requestId: String? = null): JsonObject {
        ensureScope(userId)
        val plain = sdk.decryptFolder(userId, Folder(null, ciphertext, Instant.EPOCH)).getOrThrow().name
        val payload = json.parseToJsonElement(plain).jsonObject
        require(payload["v"]?.jsonPrimitive?.intOrNull == 1)
        if (requestId != null) require(payload.text("requestId") == requestId)
        return payload
    }
}
