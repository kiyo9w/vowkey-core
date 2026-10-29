package com.vowkey.app.data.vault.datasource.disk

import android.util.Base64
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.repository.util.toEncryptedNetworkCipher
import com.vowkey.app.data.vault.repository.util.toEncryptedSdkCipher
import com.vowkey.network.model.AttachmentJsonRequest
import com.vowkey.network.model.AttachmentJsonResponse
import com.vowkey.network.model.CipherJsonRequest
import com.vowkey.network.model.CreateCipherResponseJson
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.network.model.UpdateCipherResponseJson
import com.vowkey.network.service.CiphersService
import com.vowkey.network.service.DownloadService
import com.vowkey.sdk.Client
import com.vowkey.vault.Cipher
import com.vowkey.vault.CipherType
import com.vowkey.vault.FieldType
import com.vowkey.vault.FieldView
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

class GuestVaultMigration(
    private val store: LocalVaultStore,
    private val ciphers: CiphersService,
    private val vaultSdk: VaultSdkSource,
    private val vaultDisk: VaultDiskSource,
    private val client: Client,
    private val json: Json,
    private val downloads: DownloadService,
) {
    private val gate = Mutex()

    suspend fun attach(userId: String) = gate.withLock {
        if (!store.hasGuestRecords() && store.side("migration", "target") == null) return@withLock
        store.unlock()
        val guestKey = checkNotNull(store.key())
        val accountKey = Base64.decode(vaultSdk.getUserEncryptionKey(userId).getOrThrow(), Base64.DEFAULT)
        try {
            val bound = store.side("migration", "target")
            check(bound == null || bound == userId) { "Resume this migration with the original account." }
            val journal = store.side("migration", "journal")?.let {
                json.decodeFromString<MigrationJournal>(client.crypto().symmetricDecryptString(it, accountKey))
            } ?: MigrationJournal(UUID.randomUUID().toString(), userId)
            check(journal.targetUserId == userId) { "Resume this migration with the original account." }
            store.writeSide("migration", "target", userId)
            flush(journal, accountKey)
            for (cipher in store.encrypted()) {
                val id = checkNotNull(cipher.id)
                if (id in journal.items) continue
                val owned = client.vault().ciphers().rewrapLegacyCipherKey(cipher, guestKey, accountKey)
                val body = cipherBody(owned, userId)
                val attachments = owned.attachments.orEmpty().associate { attachment ->
                    val localId = checkNotNull(attachment.id)
                    val bytes = store.attachmentFile(localId)
                    check(bytes.isFile && attachment.key != null) { "A local attachment is unavailable. The local vault is retained." }
                    localId to AttachmentMigration(
                        checksum = checksum(bytes.readBytes()),
                        request = AttachmentJsonRequest(
                            fileName = attachment.fileName,
                            key = attachment.key,
                            fileSize = bytes.length().toString(),
                            bytesChecksum = checksum(bytes.readBytes()),
                        ),
                    )
                }.toMutableMap()
                journal.items[id] = CipherMigration(cipher = json.encodeToString(owned.toStored()), body = body, hash = hash(body), attachments = attachments)
                flush(journal, accountKey)
            }
            for ((id, item) in journal.items) {
                if (item.status != "waiting-for-type") continue
                store.side("pending:$userId", id)?.let { payload ->
                    val pending = json.decodeFromString<SyncResponseJson.Cipher>(payload).toEncryptedSdkCipher()
                    item.cipher = json.encodeToString(pending.toStored())
                    item.body = cipherBody(pending, userId)
                    item.hash = hash(item.body)
                }
                item.status = "pending"
            }
            journal.phase = "upload"
            flush(journal, accountKey)
            for ((id, item) in journal.items) {
                if (item.status == "confirmed" || item.status == "waiting-for-type") continue
                if (item.targetId == null) {
                    item.status = "posting"
                    flush(journal, accountKey)
                    when (val response = ciphers.createCipher(identity(item.body, journal.id, id, item.hash)).getOrThrow()) {
                        is CreateCipherResponseJson.Success -> { item.targetId = response.cipher.id; item.status = "cipher-uploaded" }
                        is CreateCipherResponseJson.Invalid -> {
                            if (!Regex("invalid (?:cipher )?type", RegexOption.IGNORE_CASE).containsMatchIn(response.message)) error(response.message)
                            item.status = "waiting-for-type"
                        }
                    }
                    flush(journal, accountKey)
                }
                if (item.status == "waiting-for-type") continue
                for ((attachmentId, attachment) in item.attachments) {
                    if (attachment.confirmed) continue
                    val requestBody = json.encodeToJsonElement(AttachmentJsonRequest.serializer(), attachment.request).jsonObject
                    val requestHash = attachment.hash ?: hash(requestBody).also { attachment.hash = it }
                    flush(journal, accountKey)
                    val allocated = ciphers.createAttachment(checkNotNull(item.targetId), attachment.request.copy(
                        migrationId = journal.id, localResourceId = attachmentId, requestHash = requestHash,
                    )).getOrThrow()
                    if (allocated !is AttachmentJsonResponse.Success) error("The attachment could not be allocated.")
                    attachment.targetId = allocated.attachmentId
                    flush(journal, accountKey)
                    ciphers.uploadAttachment(allocated, store.attachmentFile(attachmentId)).getOrThrow()
                    val remote = ciphers.getCipherAttachment(checkNotNull(item.targetId), allocated.attachmentId).getOrThrow()
                    val bytes = downloads.getDataStream(checkNotNull(remote.url)).getOrThrow().use { it.bytes() }
                    check(checksum(bytes) == attachment.checksum) { "The uploaded attachment could not be verified." }
                    attachment.confirmed = true
                    flush(journal, accountKey)
                }
            }
            val cipherIds = journal.items.mapValues { (id, item) -> item.targetId ?: id }
            val attachmentIds = journal.items.values.flatMap { it.attachments.entries }.associate { it.key to (it.value.targetId ?: it.key) }
            journal.phase = "rewrite"
            flush(journal, accountKey)
            for ((id, item) in journal.items) {
                val source = json.decodeFromString<SyncResponseJson.Cipher>(item.cipher).toEncryptedSdkCipher()
                val rewritten = remap(source, accountKey, cipherIds, attachmentIds)
                if (item.status == "waiting-for-type") {
                    store.writeAccountPending(userId, rewritten)
                    continue
                }
                if (item.status == "confirmed") continue
                val remoteId = checkNotNull(item.targetId)
                val current = ciphers.getCipherJson(remoteId).getOrThrow()
                if (item.finalBody == null) {
                    check(current["migrationPending"] == JsonPrimitive(true)) { "The synced item changed. The local vault is retained." }
                    item.finalBody = JsonObject(cipherBody(rewritten, userId) + mapOf(
                        "migrationPending" to JsonPrimitive(false),
                        "lastKnownRevisionDate" to checkNotNull(current["revisionDate"]),
                        "expectedRevision" to checkNotNull(current["vowkeyRevision"]),
                    ))
                    flush(journal, accountKey)
                }
                val expected = checkNotNull(item.finalBody)
                if (!samePayload(current, expected) || current["migrationPending"] != JsonPrimitive(false)) {
                    when (val updated = ciphers.updateCipher(remoteId, expected).getOrThrow()) {
                        is UpdateCipherResponseJson.Invalid -> error(updated.message)
                        is UpdateCipherResponseJson.Success -> Unit
                    }
                }
                val verified = ciphers.getCipherJson(remoteId).getOrThrow()
                check(samePayload(verified, expected) && verified["migrationPending"] == JsonPrimitive(false)) { "The migrated item could not be verified." }
                val stored = json.decodeFromJsonElement<SyncResponseJson.Cipher>(verified)
                client.vault().ciphers().decryptLegacyCipher(stored.toEncryptedSdkCipher(), accountKey)
                vaultDisk.saveCipher(userId, stored)
                store.deleteSide("pending:$userId", id)
                item.status = "confirmed"
                flush(journal, accountKey)
            }
            check(journal.items.values.all { it.status == "confirmed" || it.status == "waiting-for-type" })
            journal.phase = "local-commit"
            flush(journal, accountKey)
            for ((id, item) in journal.items) {
                store.delete(id)
                if (item.status == "confirmed") item.attachments.keys.forEach { store.deleteAttachment(it) }
            }
            journal.phase = "verified"
            flush(journal, accountKey)
            store.writeSide("migration", "state", if (journal.items.values.any { it.status == "waiting-for-type" }) "attached-local-pending" else "attached")
            store.lock()
        } finally {
            guestKey.fill(0)
            accountKey.fill(0)
        }
    }

    private fun flush(journal: MigrationJournal, key: ByteArray) {
        store.writeSide("migration", "journal", client.crypto().symmetricEncryptString(json.encodeToString(journal), key))
    }

    private fun cipherBody(cipher: Cipher, userId: String): JsonObject {
        val explicit = Json(json) { explicitNulls = true }
        val wire = explicit.encodeToJsonElement(CipherJsonRequest.serializer(), cipher.toEncryptedNetworkCipher(userId, null)).jsonObject
        return JsonObject(wire.filterKeys { it != "attachments2" && it != "lastKnownRevisionDate" } + ("migrationPending" to JsonPrimitive(true)))
    }

    private fun remap(cipher: Cipher, userKey: ByteArray, cipherIds: Map<String, String>, attachmentIds: Map<String, String>): Cipher {
        val key = client.crypto().unwrapSymmetricKey(checkNotNull(cipher.key), userKey)
        try {
            fun change(encrypted: String?, rewrite: (String) -> String): String? {
                if (encrypted == null) return null
                val old = client.crypto().symmetricDecryptString(encrypted, key)
                val next = rewrite(old)
                return if (old == next) encrypted else client.crypto().symmetricEncryptString(next, key)
            }
            return cipher.copy(
                id = cipherIds[cipher.id] ?: cipher.id,
                attachments = cipher.attachments?.map { it.copy(id = attachmentIds[it.id] ?: it.id) },
                notes = change(cipher.notes) { references(it, cipherIds) },
                fields = cipher.fields?.map { field ->
                    val name = field.name?.let { client.crypto().symmetricDecryptString(it, key) }
                    if (name != "vk.meta") field else field.copy(value = change(field.value) { raw ->
                        val metadata = json.parseToJsonElement(raw).jsonObject
                        if (metadata["v"] != JsonPrimitive(1)) raw else {
                            val normalized = if (cipher.type == CipherType.IDENTITY && metadata["details"] is JsonArray) {
                                newNativeCipher(CipherType.IDENTITY).copy(fields = listOf(
                                    FieldView("vk.meta", raw, FieldType.HIDDEN, null),
                                )).profileEnvelope() ?: metadata
                            } else metadata
                            val remapped = remapJson(normalized, cipherIds, attachmentIds).jsonObject
                            if (cipher.type == CipherType.IDENTITY && remapped["details"] is JsonArray) {
                                JsonObject(remapped + ("profileId" to JsonPrimitive(cipherIds[cipher.id] ?: checkNotNull(cipher.id)))).toString()
                            } else remapped.toString()
                        }
                    })
                },
                environment = cipher.environment?.copy(members = change(cipher.environment?.members) { raw ->
                    remapJson(json.parseToJsonElement(raw), cipherIds, attachmentIds).toString()
                }),
            )
        } finally { key.fill(0) }
    }
}

@Serializable
private data class MigrationJournal(val id: String, val targetUserId: String, var phase: String = "snapshot", val items: MutableMap<String, CipherMigration> = mutableMapOf())
@Serializable
private data class CipherMigration(var cipher: String, var body: JsonObject, var hash: String, var status: String = "pending", var targetId: String? = null, var finalBody: JsonObject? = null, val attachments: MutableMap<String, AttachmentMigration> = mutableMapOf())
@Serializable
private data class AttachmentMigration(val checksum: String, val request: AttachmentJsonRequest, var hash: String? = null, var targetId: String? = null, var confirmed: Boolean = false)

private fun identity(body: JsonObject, migrationId: String, localId: String, hash: String) = JsonObject(body + buildJsonObject {
    put("migrationId", migrationId); put("localResourceId", localId); put("requestHash", hash)
})
private val payloadKeys = listOf("type", "name", "notes", "key", "fields", "login", "card", "identity", "secureNote", "sshKey", "bankAccount", "driversLicense", "passport", "apiKey", "environment")
private fun samePayload(actual: JsonObject, expected: JsonObject) = payloadKeys.all { canonical(actual[it] ?: JsonNull) == canonical(expected[it] ?: JsonNull) }
private fun canonical(value: JsonElement): String = when (value) {
    is JsonObject -> value.entries.sortedBy { it.key }.joinToString(",", "{", "}") { "${JsonPrimitive(it.key)}:${canonical(it.value)}" }
    is JsonArray -> value.joinToString(",", "[", "]", transform = ::canonical)
    else -> value.toString()
}
private fun hash(body: JsonObject) = checksum(canonical(body).toByteArray())
private fun checksum(bytes: ByteArray) = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
private fun references(text: String, ids: Map<String, String>) = Regex("@vk:([^/\\s]+)/").replace(text) { "@vk:${ids[it.groupValues[1]] ?: it.groupValues[1]}/" }
private fun remapJson(value: JsonElement, ciphers: Map<String, String>, attachments: Map<String, String>, property: String = ""): JsonElement = when (value) {
    is JsonObject -> JsonObject(value.mapValues { (key, entry) -> remapJson(entry, ciphers, attachments, key) })
    is JsonArray -> JsonArray(value.map { remapJson(it, ciphers, attachments, property) })
    is JsonPrimitive -> if (!value.isString) value else JsonPrimitive(when (property) {
        "cipherId", "sourceCipherId", "profileId", "profileCipherId", "originCipherId", "targetCipherId", "itemId", "environmentId", "cipherIds", "sourceCipherIds", "itemIds", "enabledItemIds" -> ciphers[value.content] ?: value.content
        "attachmentId", "originAttachmentId", "targetAttachmentId" -> attachments[value.content] ?: value.content
        else -> references(value.content, ciphers)
    })
    else -> value
}
