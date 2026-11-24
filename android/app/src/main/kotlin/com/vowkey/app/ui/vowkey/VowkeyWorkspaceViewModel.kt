@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod", "TooManyFunctions", "TooGenericExceptionCaught")

package com.vowkey.app.ui.vowkey

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.os.Parcelable
import android.util.Base64
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vowkey.app.BuildConfig
import com.vowkey.app.R
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.model.LogoutReason
import com.vowkey.app.data.platform.repository.SettingsRepository
import com.vowkey.app.data.vault.datasource.disk.FilledFormResult
import com.vowkey.app.data.vault.datasource.disk.GuestDecision
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.datasource.disk.LocalVaultStore
import com.vowkey.app.data.vault.datasource.disk.humanDetailLabel
import com.vowkey.app.data.vault.datasource.disk.humanDocumentTitle
import com.vowkey.app.data.vault.datasource.disk.mergeCapturedDetails
import com.vowkey.app.data.vault.datasource.disk.newCapturedNativeProfile
import com.vowkey.app.data.vault.datasource.disk.newNativeCipher
import com.vowkey.app.data.vault.datasource.disk.newNativeLogin
import com.vowkey.app.data.vault.datasource.disk.profileEnvelope
import com.vowkey.app.data.vault.datasource.disk.profileFlatDetails
import com.vowkey.app.data.vault.datasource.disk.withDetailAgentRule
import com.vowkey.app.data.vault.datasource.disk.withItemAgentRule
import com.vowkey.app.data.vault.datasource.disk.withProfileEnvelope
import com.vowkey.app.data.vault.repository.util.toEncryptedSdkCipher
import com.vowkey.app.data.vault.manager.model.GetCipherResult
import com.vowkey.app.data.vault.manager.model.SyncVaultDataResult
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.data.vault.repository.model.CreateAttachmentResult
import com.vowkey.app.data.vault.repository.model.CreateCipherResult
import com.vowkey.app.data.vault.repository.model.DownloadAttachmentResult
import com.vowkey.app.data.vault.repository.model.UpdateCipherResult
import com.vowkey.ui.platform.components.navigation.model.NavigationItem
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.vault.ApiKeyView
import com.vowkey.vault.CardView
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import com.vowkey.vault.EnvironmentMember
import com.vowkey.vault.EnvironmentView
import com.vowkey.vault.FieldType
import com.vowkey.vault.FieldView
import com.vowkey.vault.LoginUriView
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.nio.ByteBuffer
import java.security.SecureRandom
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import java.util.Collections
import java.util.UUID
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec
import javax.inject.Inject
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.isActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.parcelize.Parcelize
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

@Serializable
data object VowkeyTabVaultRoute

@Serializable
data object VowkeyTabDocumentsRoute

@Serializable
data object VowkeyTabAgentsRoute

@Serializable
data object VowkeyTabSettingsRoute

@Parcelize
enum class VowkeyTab : NavigationItem, Parcelable {
    VAULT {
        override val iconResSelected: Int get() = VowkeyDrawable.ic_vault_filled
        override val iconRes: Int get() = VowkeyDrawable.ic_vault
        override val labelRes: Int get() = VowkeyString.vault
        override val graphRoute: Any get() = VowkeyTabVaultRoute
        override val startDestinationRoute: Any get() = VowkeyTabVaultRoute
        override val testTag: String get() = "VowkeyVaultTab"
        override val notificationCount: Int get() = 0
    },
    DOCUMENTS {
        override val iconResSelected: Int get() = VowkeyDrawable.ic_file_text
        override val iconRes: Int get() = VowkeyDrawable.ic_file_text
        override val labelRes: Int get() = R.string.vk_documents
        override val graphRoute: Any get() = VowkeyTabDocumentsRoute
        override val startDestinationRoute: Any get() = VowkeyTabDocumentsRoute
        override val testTag: String get() = "VowkeyDocumentsTab"
        override val notificationCount: Int get() = 0
    },
    AGENTS {
        override val iconResSelected: Int get() = VowkeyDrawable.ic_shield
        override val iconRes: Int get() = VowkeyDrawable.ic_shield
        override val labelRes: Int get() = R.string.vk_agents
        override val graphRoute: Any get() = VowkeyTabAgentsRoute
        override val startDestinationRoute: Any get() = VowkeyTabAgentsRoute
        override val testTag: String get() = "VowkeyAgentsTab"
        override val notificationCount: Int get() = 0
    },
    SETTINGS {
        override val iconResSelected: Int get() = VowkeyDrawable.ic_settings_filled
        override val iconRes: Int get() = VowkeyDrawable.ic_settings
        override val labelRes: Int get() = VowkeyString.settings
        override val graphRoute: Any get() = VowkeyTabSettingsRoute
        override val startDestinationRoute: Any get() = VowkeyTabSettingsRoute
        override val testTag: String get() = "VowkeySettingsTab"
        override val notificationCount: Int get() = 0
    },
}

enum class VowkeySortOrder(val label: String) {
    KIND("Kind"),
    NAME("Name"),
    RECENT("Recently changed"),
}

data class VowkeyParsedLocator(
    val page: Int,
    val x: Float,
    val y: Float,
    val w: Float,
    val h: Float,
)

data class VowkeyParsedVariant(
    val id: String,
    val value: String,
    val script: String?,
    val tag: String?,
    val sourceId: String?,
    val locator: VowkeyParsedLocator?,
    val verified: Boolean,
    val origin: String?,
)

data class VowkeyParsedDetail(
    val id: String,
    val attribute: String,
    val label: String,
    val group: String,
    val chosenVariantId: String?,
    val agentRule: String,
    val variants: List<VowkeyParsedVariant>,
) {
    val selectedVariant: VowkeyParsedVariant?
        get() = variants.firstOrNull { it.id == chosenVariantId }
            ?: variants.firstOrNull { it.tag.isNullOrBlank() }
            ?: variants.firstOrNull()

    val currentValue: String
        get() = selectedVariant?.value.orEmpty()

    val isSensitive: Boolean
        get() {
            val attr = attribute.lowercase()
            if (attr.contains("expiry") || attr.contains("issued") || attr.contains("status") ||
                attr.contains("date") || attr.contains("country") || attr.contains("authority")
            ) {
                return false
            }
            return attr.startsWith("id.") ||
                attr.contains("number") ||
                attr.contains("ssn") ||
                attr.contains("tax") ||
                attr.contains("iban") ||
                attr.contains("account")
        }

    val maskedValue: String
        get() {
            val raw = currentValue.trim()
            if (!isSensitive || raw.length <= 4) return raw
            return "•••• ${raw.takeLast(4)}"
        }
}

data class VowkeyDocumentItem(
    val id: String,
    val sourceId: String,
    val attachmentId: String,
    val cipherId: String,
    val profileName: String,
    val title: String,
    val documentKind: String,
    val fileName: String,
    val mediaType: String,
    val expiresOn: String?,
    val documentDate: String?,
    val capturedAt: String?,
    val isExpiringSoon: Boolean,
    val isSample: Boolean,
)

data class VowkeyWorkspaceUiState(
    val selectedTab: VowkeyTab = VowkeyTab.VAULT,
    val searchQuery: String = "",
    val activeFilter: VowkeyItemKind = VowkeyItemKind.ALL,
    val sortOrder: VowkeySortOrder = VowkeySortOrder.KIND,
    val items: List<CipherView> = emptyList(),
    val deletedItems: List<CipherView> = emptyList(),
    val isSignedIn: Boolean = false,
    val activeEmail: String? = null,
    val appTheme: AppTheme = AppTheme.DEFAULT,
    val onDeviceOnly: Boolean = false,
    val busy: Boolean = false,
    val statusBanner: String? = null,
    val errorBanner: String? = null,
    val selectedCipherId: String? = null,
    val selectedDocumentId: String? = null,
    val editingCipher: CipherView? = null,
    val showAddDocument: Boolean = false,
    val addDocumentTargetProfileId: String? = null,
    val showFillForm: Boolean = false,
    val fillFormProfileId: String? = null,
    val filledResult: FilledFormResult? = null,
    val hasLoadedForm: Boolean = false,
    val showTrashSheet: Boolean = false,
) {
    val profiles: List<CipherView>
        get() = items.filter { it.type == CipherType.IDENTITY }.sortedWith(
            compareBy<CipherView>({ !it.favorite }, { VowkeyMobileFormat.displayName(it.name).lowercase() }),
        )

    val hasSampleData: Boolean
        get() = items.any(VowkeySampleWalkthrough::isSampleCipher)

    val documents: List<VowkeyDocumentItem>
        get() = items.flatMap { VowkeyProfileParser.extractDocuments(it) }

    val visibleFilterKinds: List<VowkeyItemKind>
        get() = buildList {
            add(VowkeyItemKind.ALL)
            add(VowkeyItemKind.PROFILE)
            add(VowkeyItemKind.DOCUMENT)
            if (documents.any { it.isExpiringSoon }) add(VowkeyItemKind.EXPIRING)
            add(VowkeyItemKind.LOGIN)
            add(VowkeyItemKind.CARD)
            add(VowkeyItemKind.KEY)
            if (items.any { it.type == CipherType.ENVIRONMENT }) add(VowkeyItemKind.ENVIRONMENT)
            add(VowkeyItemKind.NOTE)
        }

    val filteredItems: List<CipherView>
        get() {
            val q = searchQuery.trim().lowercase()
            val filtered = items.filter { cipher ->
                val kindMatch = when (activeFilter) {
                    VowkeyItemKind.ALL -> true
                    VowkeyItemKind.PROFILE -> cipher.type == CipherType.IDENTITY
                    VowkeyItemKind.DOCUMENT -> VowkeyProfileParser.extractDocuments(cipher).isNotEmpty()
                    VowkeyItemKind.EXPIRING -> VowkeyProfileParser.extractDocuments(cipher).any { it.isExpiringSoon }
                    VowkeyItemKind.LOGIN -> cipher.type == CipherType.LOGIN
                    VowkeyItemKind.CARD -> cipher.type == CipherType.CARD
                    VowkeyItemKind.KEY -> cipher.type == CipherType.API_KEY
                    VowkeyItemKind.NOTE -> cipher.type == CipherType.SECURE_NOTE
                    VowkeyItemKind.ENVIRONMENT -> cipher.type == CipherType.ENVIRONMENT
                    else -> true
                }
                if (!kindMatch) return@filter false
                if (q.isEmpty()) return@filter true
                VowkeyProfileParser.matchesSearch(cipher, q)
            }
            return when (sortOrder) {
                VowkeySortOrder.NAME -> filtered.sortedBy { VowkeyMobileFormat.displayName(it.name).lowercase() }
                VowkeySortOrder.RECENT -> filtered.sortedByDescending { it.revisionDate }
                VowkeySortOrder.KIND -> filtered.sortedWith(
                    compareBy<CipherView>(
                        { !it.favorite },
                        { VowkeyProfileParser.kindRank(it.type) },
                        { VowkeyMobileFormat.displayName(it.name).lowercase() },
                    ),
                )
            }
        }
}

object VowkeyProfileParser {
    private val json = Json { ignoreUnknownKeys = true }

    fun kindForCipher(cipher: CipherView): VowkeyItemKind = when (cipher.type) {
        CipherType.IDENTITY -> VowkeyItemKind.PROFILE
        CipherType.LOGIN -> VowkeyItemKind.LOGIN
        CipherType.CARD -> VowkeyItemKind.CARD
        CipherType.API_KEY -> VowkeyItemKind.KEY
        CipherType.ENVIRONMENT -> VowkeyItemKind.ENVIRONMENT
        CipherType.SECURE_NOTE -> VowkeyItemKind.NOTE
        else -> VowkeyItemKind.NOTE
    }

    fun kindRank(type: CipherType): Int = when (type) {
        CipherType.IDENTITY -> 0
        CipherType.LOGIN -> 1
        CipherType.CARD -> 2
        CipherType.API_KEY -> 3
        CipherType.ENVIRONMENT -> 4
        CipherType.SECURE_NOTE -> 5
        else -> 6
    }

    fun groupForAttribute(attribute: String): String = when {
        attribute.startsWith("name.") || attribute.startsWith("person.") || attribute.startsWith("birth.") -> "Personal"
        attribute.startsWith("id.") || attribute.startsWith("visa.") -> "Identification"
        attribute.startsWith("address.") || attribute.startsWith("contact.") -> "Contact & address"
        attribute.startsWith("work.") || attribute.startsWith("bank.") -> "Work & banking"
        else -> "Details"
    }

    fun parseDetails(cipher: CipherView): List<VowkeyParsedDetail> {
        if (cipher.type != CipherType.IDENTITY) return emptyList()
        val env = runCatching { cipher.profileEnvelope() }.getOrNull()
        val rawDetails = env?.get("details")?.jsonArray
        val parsed = rawDetails.orEmpty().mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val id = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val attribute = obj["attribute"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val rawLabel = obj["label"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val label = rawLabel.ifBlank { humanDetailLabel(attribute) }
            val chosenId = obj["chosenVariantId"]?.jsonPrimitive?.contentOrNull
            val agentRule = obj["agentRule"]?.jsonPrimitive?.contentOrNull ?: "fill"
            val variants = obj["variants"]?.jsonArray.orEmpty().mapNotNull { vEl ->
                val vObj = vEl as? JsonObject ?: return@mapNotNull null
                val vId = vObj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val value = vObj["value"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                val locObj = vObj["locator"] as? JsonObject
                val locator = if (locObj != null) {
                    val x = locObj["x"]?.jsonPrimitive?.doubleOrNull?.toFloat()
                    val y = locObj["y"]?.jsonPrimitive?.doubleOrNull?.toFloat()
                    val w = locObj["w"]?.jsonPrimitive?.doubleOrNull?.toFloat()
                    val h = locObj["h"]?.jsonPrimitive?.doubleOrNull?.toFloat()
                    if (x != null && y != null && w != null && h != null) {
                        VowkeyParsedLocator(
                            page = locObj["page"]?.jsonPrimitive?.intOrNull ?: 0,
                            x = x,
                            y = y,
                            w = w,
                            h = h,
                        )
                    } else {
                        null
                    }
                } else {
                    null
                }
                VowkeyParsedVariant(
                    id = vId,
                    value = value,
                    script = vObj["script"]?.jsonPrimitive?.contentOrNull,
                    tag = vObj["tag"]?.jsonPrimitive?.contentOrNull,
                    sourceId = vObj["sourceId"]?.jsonPrimitive?.contentOrNull,
                    locator = locator,
                    verified = vObj["verified"]?.jsonPrimitive?.booleanOrNull ?: false,
                    origin = vObj["origin"]?.jsonPrimitive?.contentOrNull,
                )
            }
            if (variants.isEmpty()) return@mapNotNull null
            VowkeyParsedDetail(
                id = id,
                attribute = attribute,
                label = label,
                group = groupForAttribute(attribute),
                chosenVariantId = chosenId,
                agentRule = agentRule,
                variants = variants,
            )
        }
        if (parsed.isNotEmpty()) return parsed
        return cipher.profileFlatDetails().entries.mapIndexed { idx, (attr, value) ->
            val vid = "synth-v-$idx"
            VowkeyParsedDetail(
                id = "synth-d-$idx",
                attribute = attr,
                label = humanDetailLabel(attr),
                group = groupForAttribute(attr),
                chosenVariantId = vid,
                agentRule = "fill",
                variants = listOf(
                    VowkeyParsedVariant(
                        id = vid,
                        value = value,
                        script = null,
                        tag = null,
                        sourceId = null,
                        locator = null,
                        verified = false,
                        origin = "typed",
                    ),
                ),
            )
        }
    }

    fun extractDocuments(cipher: CipherView): List<VowkeyDocumentItem> {
        if (cipher.type != CipherType.IDENTITY) return emptyList()
        val cipherId = cipher.id ?: return emptyList()
        val env = runCatching { cipher.profileEnvelope() }.getOrNull() ?: return emptyList()
        val sources = env["sources"]?.jsonArray ?: return emptyList()
        val isSample = VowkeySampleWalkthrough.isSampleCipher(cipher)
        val cleanProfile = VowkeyMobileFormat.displayName(cipher.name)
        return sources.mapNotNull { el ->
            val obj = el as? JsonObject ?: return@mapNotNull null
            val sourceId = obj["id"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            val docKind = obj["documentKind"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val fileName = obj["fileName"]?.jsonPrimitive?.contentOrNull ?: "document.png"
            val explicitAttachmentId = obj["attachmentId"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotBlank() }
            val matchedAttachmentId = cipher.attachments?.firstOrNull {
                it.fileName == fileName || it.fileName.equals(fileName, ignoreCase = true)
            }?.id?.takeIf { it.isNotBlank() }
            val attachmentId = explicitAttachmentId ?: matchedAttachmentId ?: sourceId
            val mediaType = obj["mediaType"]?.jsonPrimitive?.contentOrNull ?: "image/png"
            val title = humanDocumentTitle(obj, fileName)
            val expiresOn = obj["expiresOn"]?.jsonPrimitive?.contentOrNull
            val isExpiring = expiresOn?.let { exp ->
                runCatching {
                    val days = ChronoUnit.DAYS.between(LocalDate.now(), LocalDate.parse(exp.take(10)))
                    days <= 180
                }.getOrDefault(false)
            } ?: false
            VowkeyDocumentItem(
                id = "$cipherId:$sourceId",
                sourceId = sourceId,
                attachmentId = attachmentId,
                cipherId = cipherId,
                profileName = cleanProfile,
                title = title,
                documentKind = docKind.ifBlank { title },
                fileName = fileName,
                mediaType = mediaType,
                expiresOn = expiresOn,
                documentDate = obj["documentDate"]?.jsonPrimitive?.contentOrNull,
                capturedAt = obj["capturedAt"]?.jsonPrimitive?.contentOrNull,
                isExpiringSoon = isExpiring,
                isSample = isSample,
            )
        }
    }

    fun subtitleForCipher(cipher: CipherView): String {
        return when (cipher.type) {
            CipherType.IDENTITY -> {
                val details = parseDetails(cipher)
                val docs = extractDocuments(cipher)
                val parts = buildList {
                    if (details.isNotEmpty()) add("${details.size} ${if (details.size == 1) "detail" else "details"}")
                    if (docs.isNotEmpty()) add("${docs.size} ${if (docs.size == 1) "document" else "documents"}")
                }
                parts.joinToString(" · ").ifEmpty { "Profile" }
            }
            CipherType.LOGIN -> {
                val user = cipher.login?.username.orEmpty()
                val host = cipher.login?.uris?.firstOrNull()?.uri.orEmpty()
                    .removePrefix("https://")
                    .removePrefix("http://")
                    .substringBefore('/')
                listOf(user, host).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { "Login" }
            }
            CipherType.CARD -> {
                val last4 = cipher.card?.number.orEmpty().filter(Char::isDigit).takeLast(4)
                val holder = cipher.card?.cardholderName.orEmpty()
                listOf(
                    if (last4.isNotEmpty()) "•••• $last4" else "",
                    holder,
                ).filter { it.isNotBlank() }.joinToString(" · ").ifEmpty { "Payment card" }
            }
            CipherType.API_KEY -> {
                val style = cipher.apiKey?.sendStyle ?: "bearer"
                val hosts = cipher.apiKey?.allowedHosts.orEmpty()
                if (hosts.isNotEmpty()) "$style · ${hosts.first()}" else "$style · @vk:${(cipher.id ?: "key").take(8)}…/key.value"
            }
            CipherType.ENVIRONMENT -> {
                val count = cipher.environment?.members?.size ?: 0
                "$count ${if (count == 1) "variable" else "variables"}"
            }
            CipherType.SECURE_NOTE -> {
                cipher.notes.orEmpty().lineSequence().firstOrNull { it.isNotBlank() }?.take(56) ?: "Secure note"
            }
            else -> "Item"
        }
    }

    fun matchesSearch(cipher: CipherView, q: String): Boolean {
        if (cipher.name.lowercase().contains(q)) return true
        if (cipher.notes.orEmpty().lowercase().contains(q)) return true
        if (cipher.login?.username.orEmpty().lowercase().contains(q)) return true
        if (cipher.login?.uris.orEmpty().any { it.uri.orEmpty().lowercase().contains(q) }) return true
        if (cipher.card?.cardholderName.orEmpty().lowercase().contains(q)) return true
        if (cipher.apiKey?.allowedHosts.orEmpty().any { it.lowercase().contains(q) }) return true
        if (cipher.environment?.members.orEmpty().any { it.name.lowercase().contains(q) }) return true
        if (cipher.type == CipherType.IDENTITY) {
            for (d in parseDetails(cipher)) {
                if (d.label.lowercase().contains(q) || d.attribute.lowercase().contains(q)) return true
                if (d.variants.any { it.value.lowercase().contains(q) }) return true
            }
            if (extractDocuments(cipher).any { it.title.lowercase().contains(q) || it.fileName.lowercase().contains(q) }) {
                return true
            }
        }
        return false
    }
}

object VowkeyCryptoGenerator {
    private val rng = SecureRandom()
    private val words = listOf(
        "amber", "anchor", "apricot", "atlas", "aurora", "bamboo", "beacon", "birch",
        "breeze", "bridge", "canyon", "cedar", "cobalt", "comet", "coral", "cosmos",
        "crystal", "cypress", "dawn", "delta", "dune", "echo", "ember", "falcon",
        "fern", "fjord", "flint", "forest", "frost", "galaxy", "glacier", "granite",
        "harbor", "hazel", "horizon", "indigo", "island", "ivory", "jasper", "juniper",
        "lagoon", "lantern", "laurel", "linen", "lotus", "maple", "meadow", "mercury",
        "mist", "monolith", "nebula", "oak", "obsidian", "olive", "onyx", "opal",
        "orbit", "orchid", "osprey", "pebble", "phoenix", "pine", "plume", "prism",
        "quartz", "quiver", "raven", "reef", "ridge", "river", "saffron", "sage",
        "sequoia", "shadow", "sierra", "silver", "solstice", "sparrow", "spruce", "starlight",
        "summit", "SUNSET".lowercase(), "terrace", "thistle", "thunder", "timber", "topaz", "tundra",
        "velvet", "verge", "violet", "voyage", "willow", "zephyr",
    )

    fun password(
        length: Int = 20,
        uppercase: Boolean = true,
        digits: Boolean = true,
        symbols: Boolean = true,
    ): String {
        val lower = "abcdefghijkmnopqrstuvwxyz"
        val upper = "ABCDEFGHJKLMNPQRSTUVWXYZ"
        val num = "23456789"
        val sym = "!@#%^&*-_=+?"
        val pool = buildString {
            append(lower)
            if (uppercase) append(upper)
            if (digits) append(num)
            if (symbols) append(sym)
        }
        val chars = mutableListOf<Char>()
        chars.add(lower[rng.nextInt(lower.length)])
        if (uppercase) chars.add(upper[rng.nextInt(upper.length)])
        if (digits) chars.add(num[rng.nextInt(num.length)])
        if (symbols) chars.add(sym[rng.nextInt(sym.length)])
        while (chars.size < length.coerceIn(8, 64)) {
            chars.add(pool[rng.nextInt(pool.length)])
        }
        chars.shuffle(rng)
        return chars.joinToString("")
    }

    fun passphrase(wordCount: Int = 4, separator: String = "-", capitalize: Boolean = false): String {
        return (0 until wordCount.coerceIn(3, 8)).joinToString(separator) {
            val w = words[rng.nextInt(words.size)]
            if (capitalize) w.replaceFirstChar { c -> c.titlecase() } else w
        }
    }

    fun pin(length: Int = 6): String {
        return (0 until length.coerceIn(4, 12)).joinToString("") { rng.nextInt(10).toString() }
    }
}

object VowkeyTotp {
    fun compute(rawSecret: String, epochSeconds: Long = System.currentTimeMillis() / 1000L): Pair<String, Int>? {
        val clean = rawSecret.trim()
        if (clean.isEmpty()) return null
        val secretParam = if (clean.startsWith("otpauth://", ignoreCase = true)) {
            clean.substringAfter("secret=", "").substringBefore('&')
        } else {
            clean
        }
        val keyBytes = decodeBase32(secretParam) ?: return null
        if (keyBytes.isEmpty()) return null
        val counter = epochSeconds / 30L
        val remaining = (30L - (epochSeconds % 30L)).toInt()
        return runCatching {
            val buf = ByteBuffer.allocate(8).putLong(counter).array()
            val mac = Mac.getInstance("HmacSHA1")
            mac.init(SecretKeySpec(keyBytes, "HmacSHA1"))
            val hash = mac.doFinal(buf)
            val offset = hash.last().toInt() and 0x0F
            val binary = ((hash[offset].toInt() and 0x7F) shl 24) or
                ((hash[offset + 1].toInt() and 0xFF) shl 16) or
                ((hash[offset + 2].toInt() and 0xFF) shl 8) or
                (hash[offset + 3].toInt() and 0xFF)
            val otp = (binary % 10.0.pow(6).toInt()).toString().padStart(6, '0')
            "${otp.take(3)} ${otp.takeLast(3)}" to remaining
        }.getOrNull()
    }

    private fun decodeBase32(input: String): ByteArray? {
        val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
        val cleaned = input.uppercase().filter { it in alphabet }
        if (cleaned.isEmpty()) return null
        var buffer = 0
        var bitsLeft = 0
        val out = ArrayList<Byte>(cleaned.length * 5 / 8)
        for (ch in cleaned) {
            val idx = alphabet.indexOf(ch)
            if (idx < 0) return null
            buffer = (buffer shl 5) or idx
            bitsLeft += 5
            if (bitsLeft >= 8) {
                bitsLeft -= 8
                out.add(((buffer shr bitsLeft) and 0xFF).toByte())
            }
        }
        return out.toByteArray()
    }
}

@HiltViewModel
class VowkeyWorkspaceViewModel @Inject constructor(
    @ApplicationContext private val appContext: Context,
    private val localStore: LocalVaultStore,
    private val decision: GuestDecision,
    private val authRepository: AuthRepository,
    private val vaultRepository: VaultRepository,
    private val settingsRepository: SettingsRepository,
    private val authDiskSource: AuthDiskSource,
    private val vaultDiskSource: VaultDiskSource,
    private val vaultSdkSource: VaultSdkSource,
) : ViewModel() {

    private val json = Json {
        ignoreUnknownKeys = true
        prettyPrint = true
        encodeDefaults = true
    }

    private val _uiState = MutableStateFlow(
        VowkeyWorkspaceUiState(
            appTheme = settingsRepository.appTheme,
            onDeviceOnly = decision.onDeviceOnly,
        ),
    )
    val uiState: StateFlow<VowkeyWorkspaceUiState> = _uiState.asStateFlow()

    private val autoSyncedUserIds: MutableSet<String> = Collections.synchronizedSet(mutableSetOf())
    private var originalsJob: Job? = null
    private var retainedOriginalSignature: String? = null
    private val bitmapCache: MutableMap<String, Bitmap> = Collections.synchronizedMap(LinkedHashMap())
    private var cachedAccountId: String? = null
    private var lastFormInput: Triple<ByteArray, String, String>? = null

    init {
        combine(
            authRepository.userStateFlow,
            vaultRepository.decryptCipherListResultStateFlow,
            settingsRepository.appThemeStateFlow,
        ) { userState, ciphers, theme ->
            Triple(userState, ciphers, theme)
        }
            .onEach { (userState, ciphers, theme) ->
                val active = userState?.activeAccount
                val signedIn = active?.isLoggedIn == true && active.isVaultUnlocked
                if (cachedAccountId != active?.userId || !signedIn) {
                    bitmapCache.clear()
                    originalsJob?.cancel()
                    retainedOriginalSignature = null
                    cachedAccountId = if (signedIn) active?.userId else null
                }
                if (signedIn && autoSyncedUserIds.add(active.userId)) {
                    vaultRepository.sync(forced = false)
                }
                _uiState.update {
                    it.copy(
                        isSignedIn = signedIn,
                        activeEmail = active?.email,
                        appTheme = theme,
                    )
                }
                if (signedIn) {
                    val rows = ciphers.data?.successes.orEmpty()
                    val signature = rows.mapNotNull { row ->
                        row.id?.let { id -> "$id:${row.revisionDate.toEpochMilli()}:${row.attachments}" }
                    }.sorted().joinToString("|")
                    if (retainedOriginalSignature != signature) {
                        originalsJob?.cancel()
                        val userId = active.userId
                        originalsJob = viewModelScope.launch {
                            var decryptedAll = true
                            val views = ArrayList<CipherView>(rows.size)
                            for (row in rows) {
                                if (!currentCoroutineContext().isActive) return@launch
                                val id = row.id ?: continue
                                when (val result = vaultRepository.getCipher(id)) {
                                    is GetCipherResult.Success -> views.add(result.cipherView)
                                    else -> decryptedAll = false
                                }
                            }
                            if (
                                decryptedAll &&
                                retainAccountOriginals(userId, views) &&
                                currentCoroutineContext().isActive
                            ) {
                                retainedOriginalSignature = signature
                            }
                        }
                    }
                }
                reloadVault()
            }
            .launchIn(viewModelScope)

        reloadVault()
        runDebugAutoIfPresent()
    }

    fun selectTab(tab: VowkeyTab) {
        _uiState.update { it.copy(selectedTab = tab) }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun setActiveFilter(kind: VowkeyItemKind) {
        _uiState.update { it.copy(activeFilter = kind) }
    }

    fun setSortOrder(order: VowkeySortOrder) {
        _uiState.update { it.copy(sortOrder = order) }
    }

    fun dismissBanner() {
        _uiState.update { it.copy(statusBanner = null, errorBanner = null) }
    }

    fun openCipherDetail(cipherId: String?) {
        _uiState.update { it.copy(selectedCipherId = cipherId) }
    }

    fun openDocumentDetail(documentId: String?) {
        _uiState.update { it.copy(selectedDocumentId = documentId) }
    }

    fun startCreateCipher(kind: VowkeyItemKind) {
        val draft = when (kind) {
            VowkeyItemKind.PROFILE -> {
                newCapturedNativeProfile(
                    name = "",
                    values = emptyMap(),
                    origin = "typed",
                )
            }
            VowkeyItemKind.LOGIN -> {
                newNativeCipher(CipherType.LOGIN).copy(
                    name = "",
                    login = newNativeLogin(),
                )
            }
            VowkeyItemKind.CARD -> {
                newNativeCipher(CipherType.CARD).copy(
                    name = "",
                    card = CardView(
                        cardholderName = "",
                        expMonth = "",
                        expYear = "",
                        code = "",
                        brand = "",
                        number = "",
                    ),
                )
            }
            VowkeyItemKind.KEY -> {
                newNativeCipher(CipherType.API_KEY).copy(
                    name = "",
                    apiKey = ApiKeyView(
                        value = "",
                        sendStyle = "bearer",
                        allowedHosts = emptyList(),
                        headerName = null,
                        basicUsername = null,
                    ),
                )
            }
            VowkeyItemKind.ENVIRONMENT -> {
                newNativeCipher(CipherType.ENVIRONMENT).copy(
                    name = "",
                    environment = EnvironmentView(members = emptyList()),
                )
            }
            else -> {
                newNativeCipher(CipherType.SECURE_NOTE).copy(
                    name = "",
                    notes = "",
                )
            }
        }
        _uiState.update { it.copy(editingCipher = draft) }
    }

    fun startEditCipher(cipher: CipherView) {
        _uiState.update { it.copy(editingCipher = cipher) }
    }

    fun closeEditor() {
        _uiState.update { it.copy(editingCipher = null) }
    }

    fun openAddDocument(targetProfileId: String? = null) {
        _uiState.update {
            it.copy(
                showAddDocument = true,
                addDocumentTargetProfileId = targetProfileId,
                errorBanner = null,
            )
        }
    }

    fun closeAddDocument() {
        _uiState.update {
            it.copy(
                showAddDocument = false,
                addDocumentTargetProfileId = null,
                errorBanner = null,
            )
        }
    }

    fun openFillForm(profileId: String? = null) {
        val defaultId = profileId ?: _uiState.value.profiles.firstOrNull()?.id
        lastFormInput = null
        _uiState.update {
            it.copy(
                showFillForm = true,
                fillFormProfileId = defaultId,
                filledResult = null,
                hasLoadedForm = false,
                errorBanner = null,
            )
        }
    }

    fun closeFillForm() {
        lastFormInput = null
        _uiState.update {
            it.copy(
                showFillForm = false,
                filledResult = null,
                hasLoadedForm = false,
                errorBanner = null,
            )
        }
    }

    fun clearFilledForm() {
        lastFormInput = null
        _uiState.update {
            it.copy(
                filledResult = null,
                hasLoadedForm = false,
                errorBanner = null,
            )
        }
    }

    fun setOnDeviceOnly(enabled: Boolean) {
        decision.onDeviceOnly = enabled
        _uiState.update { it.copy(onDeviceOnly = enabled) }
    }

    fun setShowTrashSheet(show: Boolean) {
        _uiState.update { it.copy(showTrashSheet = show) }
    }

    private fun humanErrorMessage(err: Throwable, fallback: String): String {
        if (err is java.io.IOException) {
            return "Couldn't reach Vowkey. Check your connection and try again."
        }
        val msg = err.message?.trim().orEmpty()
        if (msg.isNotEmpty() &&
            !msg.equals("timeout", ignoreCase = true) &&
            !msg.contains("Exception") &&
            !msg.contains("Required value")
        ) {
            return msg
        }
        return fallback
    }

    fun setAppTheme(theme: AppTheme) {
        settingsRepository.appTheme = theme
        _uiState.update { it.copy(appTheme = theme) }
    }

    fun lockCurrentVault() {
        if (_uiState.value.isSignedIn) {
            vaultRepository.lockVaultForCurrentUser(isUserInitiated = true)
        } else {
            localStore.lock()
            localStore.unlock()
            _uiState.update { it.copy(statusBanner = "Local vault refreshed") }
        }
    }

    fun signOut() {
        if (_uiState.value.isSignedIn) {
            authRepository.logout(reason = LogoutReason.Click(source = "VowkeySettings"))
        }
    }

    fun syncNow() {
        if (!_uiState.value.isSignedIn) {
            reloadVault()
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, errorBanner = null, statusBanner = null) }
            val syncResult = runCatching {
                vaultRepository.syncForResult(forced = true)
            }.getOrNull()
            val (active, deleted) = withContext(Dispatchers.IO) {
                loadActiveAndDeletedItems()
            }
            val succeeded = syncResult is SyncVaultDataResult.Success
            _uiState.update {
                it.copy(
                    busy = false,
                    items = active,
                    deletedItems = deleted,
                    statusBanner = if (succeeded) "Synced" else null,
                    errorBanner = if (succeeded) null else "Couldn't sync right now. Check your connection.",
                )
            }
        }
    }

    fun reloadVault() {
        viewModelScope.launch {
            val (active, deleted) = withContext(Dispatchers.IO) {
                loadActiveAndDeletedItems()
            }
            _uiState.update { state ->
                state.copy(
                    items = active,
                    deletedItems = deleted,
                )
            }
        }
    }

    private suspend fun loadActiveAndDeletedItems(): Pair<List<CipherView>, List<CipherView>> {
        localStore.unlock()
        val localAll = runCatching { localStore.items() }.getOrDefault(emptyList())
        val userState = authRepository.userStateFlow.value
        val activeUser = userState?.activeAccount
        if (activeUser == null || !activeUser.isLoggedIn || !activeUser.isVaultUnlocked) {
            val active = localAll.filter { it.deletedDate == null }
            val deleted = localAll.filter { it.deletedDate != null }
            return active to deleted
        }

        val listViews = vaultRepository.decryptCipherListResultStateFlow.value.data?.successes.orEmpty()
        val accountCiphers = listViews.mapNotNull { row ->
            val id = row.id ?: return@mapNotNull null
            (vaultRepository.getCipher(id) as? GetCipherResult.Success)?.cipherView
        }
        val pendingLocal = runCatching {
            val key = Base64.decode(
                vaultSdkSource.getUserEncryptionKey(activeUser.userId).getOrThrow(),
                Base64.DEFAULT,
            )
            try {
                localStore.accountPending(activeUser.userId, key)
            } finally {
                key.fill(0)
            }
        }.getOrDefault(emptyList())

        val sampleOrGuestLocal = localAll.filter { localItem ->
            accountCiphers.none { it.id == localItem.id }
        }
        val merged = accountCiphers +
            pendingLocal.filter { p -> accountCiphers.none { it.id == p.id } } +
            sampleOrGuestLocal.filter { g -> accountCiphers.none { it.id == g.id } && pendingLocal.none { it.id == g.id } }

        return merged.filter { it.deletedDate == null } to merged.filter { it.deletedDate != null }
    }

    private suspend fun persistCipher(cipher: CipherView): String {
        val updated = cipher.copy(revisionDate = Instant.now())
        val isLocalSample = VowkeySampleWalkthrough.isSampleCipher(updated)
        if (!_uiState.value.isSignedIn || isLocalSample || localStore.item(updated.id.orEmpty()) != null) {
            return withContext(Dispatchers.IO) {
                localStore.save(updated)
            }
        }
        return if (updated.id.isNullOrBlank()) {
            when (val res = vaultRepository.createCipher(updated)) {
                is CreateCipherResult.Success -> res.cipherId.ifBlank { UUID.randomUUID().toString() }
                is CreateCipherResult.Error -> withContext(Dispatchers.IO) { localStore.save(updated) }
            }
        } else {
            val id = updated.id!!
            when (vaultRepository.updateCipher(id, updated)) {
                UpdateCipherResult.Success -> id
                is UpdateCipherResult.Error -> withContext(Dispatchers.IO) { localStore.save(updated) }
            }
        }
    }

    fun saveCipher(cipher: CipherView, statusMessage: String = "Saved") {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, errorBanner = null) }
            runCatching {
                val clean = if (cipher.name.isBlank()) {
                    cipher.copy(name = VowkeyProfileParser.kindForCipher(cipher).singularTitle)
                } else {
                    cipher
                }
                persistCipher(clean)
            }.onSuccess { savedId ->
                val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
                _uiState.update {
                    it.copy(
                        busy = false,
                        items = active,
                        deletedItems = deleted,
                        editingCipher = null,
                        selectedCipherId = savedId,
                        statusBanner = statusMessage,
                    )
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        busy = false,
                        errorBanner = humanErrorMessage(err, "Couldn't save this item."),
                    )
                }
            }
        }
    }

    fun toggleFavorite(cipher: CipherView) {
        viewModelScope.launch {
            val next = cipher.copy(favorite = !cipher.favorite, revisionDate = Instant.now())
            runCatching { persistCipher(next) }
            reloadVault()
        }
    }

    fun softDelete(cipher: CipherView) {
        val id = cipher.id ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true) }
            withContext(Dispatchers.IO) {
                if (!_uiState.value.isSignedIn || localStore.item(id) != null) {
                    localStore.save(cipher.copy(deletedDate = Instant.now(), revisionDate = Instant.now()))
                } else {
                    vaultRepository.softDeleteCipher(id, cipher)
                }
            }
            val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
            _uiState.update {
                it.copy(
                    busy = false,
                    items = active,
                    deletedItems = deleted,
                    selectedCipherId = if (it.selectedCipherId == id) null else it.selectedCipherId,
                    statusBanner = "Moved to Recently deleted",
                )
            }
        }
    }

    fun restoreItem(cipher: CipherView) {
        val id = cipher.id ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                if (!_uiState.value.isSignedIn || localStore.item(id) != null) {
                    localStore.save(cipher.copy(deletedDate = null, revisionDate = Instant.now()))
                } else {
                    vaultRepository.restoreCipher(id, cipher)
                }
            }
            val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
            _uiState.update {
                it.copy(
                    items = active,
                    deletedItems = deleted,
                    statusBanner = "Restored ${VowkeyMobileFormat.displayName(cipher.name)}",
                )
            }
        }
    }

    fun hardDelete(cipher: CipherView) {
        val id = cipher.id ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                VowkeyProfileParser.extractDocuments(cipher).forEach { doc ->
                    runCatching { localStore.deleteAttachment(doc.attachmentId) }
                    bitmapCache.keys.removeAll { it.startsWith("${doc.attachmentId}:") }
                }
                if (localStore.item(id) != null) {
                    localStore.delete(id)
                } else if (_uiState.value.isSignedIn) {
                    vaultRepository.hardDeleteCipher(id)
                }
            }
            reloadVault()
        }
    }

    fun emptyTrash() {
        viewModelScope.launch {
            val targets = _uiState.value.deletedItems
            withContext(Dispatchers.IO) {
                for (cipher in targets) {
                    val id = cipher.id ?: continue
                    VowkeyProfileParser.extractDocuments(cipher).forEach { doc ->
                        runCatching { localStore.deleteAttachment(doc.attachmentId) }
                    }
                    if (localStore.item(id) != null) {
                        localStore.delete(id)
                    } else if (_uiState.value.isSignedIn) {
                        vaultRepository.hardDeleteCipher(id)
                    }
                }
            }
            reloadVault()
            _uiState.update { it.copy(showTrashSheet = false, statusBanner = "Emptied Recently deleted") }
        }
    }

    // MARK: Sample Walkthrough

    fun loadSampleScenario(scenario: VowkeySampleScenario) {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true) }
            val savedId = withContext(Dispatchers.IO) {
                localStore.unlock()
                val existing = localStore.items().firstOrNull {
                    it.deletedDate == null && VowkeySampleWalkthrough.scenarioForCipher(it)?.id == scenario.id
                }
                if (existing != null) {
                    existing.id
                } else {
                    writeSampleScenarioToStore(scenario)
                }
            }
            val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
            _uiState.update {
                it.copy(
                    busy = false,
                    items = active,
                    deletedItems = deleted,
                    selectedCipherId = savedId,
                    statusBanner = "Loaded sample ${scenario.chipTitle.lowercase()}",
                )
            }
        }
    }

    fun loadAllSamples() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true) }
            withContext(Dispatchers.IO) {
                localStore.unlock()
                val current = localStore.items().filter { it.deletedDate == null }
                for (scenario in VowkeySampleWalkthrough.scenarios) {
                    if (current.none { VowkeySampleWalkthrough.scenarioForCipher(it)?.id == scenario.id }) {
                        writeSampleScenarioToStore(scenario)
                    }
                }
            }
            val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
            _uiState.update {
                it.copy(
                    busy = false,
                    items = active,
                    deletedItems = deleted,
                    statusBanner = "Loaded 3 sample profiles and documents",
                )
            }
        }
    }

    private fun writeSampleScenarioToStore(scenario: VowkeySampleScenario): String {
        val attachmentId = "${VowkeySampleWalkthrough.SAMPLE_ATTACHMENT_PREFIX}${scenario.id}"
        val pngBytes = VowkeySampleWalkthrough.renderSamplePngBytes(scenario)
        val file = localStore.attachmentFile(attachmentId)
        file.parentFile?.mkdirs()
        file.writeBytes(pngBytes)
        val cipher = VowkeySampleWalkthrough.buildSampleCipher(
            scenario = scenario,
            attachmentId = attachmentId,
            pngSize = pngBytes.size.toLong(),
        )
        return localStore.save(cipher)
    }

    fun clearSampleData() {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true) }
            withContext(Dispatchers.IO) {
                localStore.unlock()
                val samples = localStore.items().filter(VowkeySampleWalkthrough::isSampleCipher)
                for (sample in samples) {
                    VowkeyProfileParser.extractDocuments(sample).forEach { doc ->
                        runCatching { localStore.deleteAttachment(doc.attachmentId) }
                        bitmapCache.keys.removeAll { it.startsWith("${doc.attachmentId}:") }
                    }
                    sample.id?.let(localStore::delete)
                }
            }
            val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
            _uiState.update {
                it.copy(
                    busy = false,
                    items = active,
                    deletedItems = deleted,
                    selectedCipherId = null,
                    selectedDocumentId = null,
                    statusBanner = "Removed sample data",
                )
            }
        }
    }

    // MARK: Document Capture & Form Fill

    fun captureDocumentBytes(
        profileName: String,
        targetProfileId: String?,
        bytes: ByteArray,
        fileName: String,
        mediaType: String,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(busy = true, errorBanner = null) }
            runCatching {
                val res = decision.readDocumentBytes(
                    bytes = bytes,
                    fileName = fileName,
                    mediaType = mediaType,
                    cacheDir = appContext.cacheDir,
                )
                if (res.details.isEmpty()) error("Couldn't read any details from this document.")
                val existing = targetProfileId?.let { id -> _uiState.value.items.firstOrNull { it.id == id } }
                val resolvedName = profileName.trim().ifBlank {
                    inferProfileName(res.details, fileName.substringBeforeLast('.').ifBlank { "Profile" })
                }
                val savedId = persistCapturedDocument(
                    existing = existing,
                    resolvedName = resolvedName,
                    bytes = bytes,
                    fileName = fileName,
                    res = res,
                )
                savedId to res.details.size
            }.onSuccess { (savedId, count) ->
                val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
                _uiState.update {
                    it.copy(
                        busy = false,
                        items = active,
                        deletedItems = deleted,
                        showAddDocument = false,
                        addDocumentTargetProfileId = null,
                        selectedCipherId = savedId,
                        statusBanner = "Extracted $count details from document",
                    )
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        busy = false,
                        errorBanner = humanErrorMessage(
                            err,
                            "Couldn't read that document. Try a clearer photo or another file.",
                        ),
                    )
                }
            }
        }
    }

    private suspend fun persistCapturedDocument(
        existing: CipherView?,
        resolvedName: String,
        bytes: ByteArray,
        fileName: String,
        res: com.vowkey.app.data.vault.datasource.disk.CapturedDocumentResult,
    ): String {
        val localAttachmentId = res.sourceRecord["attachmentId"]?.jsonPrimitive?.contentOrNull
            ?: res.sourceRecord["id"]?.jsonPrimitive?.contentOrNull
            ?: UUID.randomUUID().toString()

        val isLocalTarget = existing != null && (
            VowkeySampleWalkthrough.isSampleCipher(existing) ||
                withContext(Dispatchers.IO) { localStore.item(existing.id.orEmpty()) != null }
            )

        if (_uiState.value.isSignedIn && !isLocalTarget) {
            val serverPair: Pair<String, CipherView>? = if (existing?.id != null) {
                existing.id!! to existing
            } else {
                val seed = newCapturedNativeProfile(name = resolvedName, values = emptyMap(), origin = "ocr")
                when (val created = vaultRepository.createCipher(seed)) {
                    is CreateCipherResult.Success -> {
                        val cid = created.cipherId
                        val fetched = (vaultRepository.getCipher(cid) as? GetCipherResult.Success)?.cipherView
                            ?: seed.copy(id = cid)
                        cid to fetched
                    }
                    is CreateCipherResult.Error -> null
                }
            }

            if (serverPair != null) {
                val (serverId, serverCipher) = serverPair
                val localFile = withContext(Dispatchers.IO) {
                    localStore.attachmentFile(localAttachmentId).apply {
                        if (!exists()) {
                            parentFile?.mkdirs()
                            writeBytes(bytes)
                        }
                    }
                }
                val attRes = vaultRepository.createAttachment(
                    cipherId = serverId,
                    cipherView = serverCipher,
                    fileSizeBytes = bytes.size.toString(),
                    fileName = fileName,
                    fileUri = Uri.fromFile(localFile),
                )
                if (attRes is CreateAttachmentResult.Success) {
                    val finalAttachmentId = attRes.cipherView.attachments?.lastOrNull()?.id ?: localAttachmentId
                    if (finalAttachmentId != localAttachmentId) {
                        withContext(Dispatchers.IO) {
                            val finalFile = localStore.attachmentFile(finalAttachmentId)
                            finalFile.parentFile?.mkdirs()
                            finalFile.writeBytes(bytes)
                            runCatching { localStore.deleteAttachment(localAttachmentId) }
                        }
                    }
                    val finalSourceRecord = buildJsonObject {
                        res.sourceRecord.forEach { (k, v) -> put(k, v) }
                        put("id", finalAttachmentId)
                        put("attachmentId", finalAttachmentId)
                    }
                    val merged = attRes.cipherView.mergeCapturedDetails(
                        values = res.details,
                        locators = res.locators,
                        sourceRecord = finalSourceRecord,
                        origin = "ocr",
                    ).copy(revisionDate = Instant.now())
                    if (vaultRepository.updateCipher(serverId, merged) is UpdateCipherResult.Success) {
                        return serverId
                    }
                }
            }
        }

        val fallbackCipher = if (existing != null) {
            existing.mergeCapturedDetails(
                values = res.details,
                locators = res.locators,
                sourceRecord = res.sourceRecord,
                origin = "ocr",
            )
        } else {
            newCapturedNativeProfile(
                name = resolvedName,
                values = res.details,
                locators = res.locators,
                sourceRecord = res.sourceRecord,
                origin = "ocr",
            )
        }
        return persistCipher(fallbackCipher)
    }

    fun fillFormBytes(
        selectedProfileId: String?,
        bytes: ByteArray,
        fileName: String,
        mediaType: String,
    ) {
        if (_uiState.value.busy) return
        lastFormInput = Triple(bytes, fileName, mediaType)
        _uiState.update {
            it.copy(
                busy = true,
                errorBanner = null,
                statusBanner = null,
                filledResult = null,
                fillFormProfileId = selectedProfileId,
                hasLoadedForm = true,
            )
        }
        viewModelScope.launch {
            runCatching {
                decision.fillFormBytes(
                    bytes = bytes,
                    fileName = fileName,
                    mediaType = mediaType,
                    cacheDir = appContext.cacheDir,
                    profiles = _uiState.value.profiles,
                    selectedProfileId = selectedProfileId,
                    cards = _uiState.value.items.filter { it.type == CipherType.CARD },
                )
            }.onSuccess { result ->
                if (result.filledCount <= 0) {
                    _uiState.update {
                        it.copy(
                            busy = false,
                            fillFormProfileId = selectedProfileId,
                            filledResult = null,
                            hasLoadedForm = true,
                            errorBanner = "No matching fields were found on this form for the selected profile.",
                        )
                    }
                } else {
                    _uiState.update {
                        it.copy(
                            busy = false,
                            fillFormProfileId = selectedProfileId,
                            filledResult = result,
                            hasLoadedForm = true,
                            errorBanner = null,
                        )
                    }
                }
            }.onFailure { err ->
                _uiState.update {
                    it.copy(
                        busy = false,
                        errorBanner = humanErrorMessage(
                            err,
                            "Couldn't fill that form right now. Try again.",
                        ),
                    )
                }
            }
        }
    }

    fun refillLastForm(profileId: String?) {
        val input = lastFormInput ?: run {
            _uiState.update { it.copy(fillFormProfileId = profileId) }
            return
        }
        fillFormBytes(profileId, input.first, input.second, input.third)
    }

    fun setProfileDetailAgentRule(cipher: CipherView, detailId: String, rule: String) {
        saveCipher(
            cipher = cipher.withDetailAgentRule(detailId, rule),
            statusMessage = "Updated AI access",
        )
    }

    fun setItemAgentRule(cipher: CipherView, rule: String) {
        saveCipher(
            cipher = cipher.withItemAgentRule(rule),
            statusMessage = "Updated AI access",
        )
    }

    // MARK: Profile Detail Editing

    fun renameProfile(cipher: CipherView, newName: String) {
        val trimmed = newName.trim()
        if (trimmed.isEmpty()) return
        saveCipher(cipher.copy(name = trimmed), statusMessage = "Updated profile name")
    }

    fun selectDetailVariant(cipher: CipherView, detailId: String, variantId: String) {
        val env = runCatching { cipher.profileEnvelope() }.getOrNull() ?: return
        val updatedDetails = env["details"]?.jsonArray.orEmpty().map { el ->
            val obj = el.jsonObject
            if (obj["id"]?.jsonPrimitive?.contentOrNull == detailId) {
                JsonObject(obj.toMutableMap().apply { put("chosenVariantId", JsonPrimitive(variantId)) })
            } else {
                obj
            }
        }
        val nextEnv = JsonObject(env.toMutableMap().apply { put("details", JsonArray(updatedDetails)) })
        saveCipher(cipher.withProfileEnvelope(nextEnv), statusMessage = "Switched preferred script")
    }

    fun upsertProfileDetail(
        cipher: CipherView,
        detailId: String?,
        label: String,
        attribute: String,
        value: String,
        script: String?,
        agentRule: String,
    ) {
        val cleanLabel = label.trim().ifBlank { humanDetailLabel(attribute.ifBlank { "detail.custom" }) }
        val cleanValue = value.trim()
        if (cleanValue.isEmpty()) return
        val cleanAttr = attribute.trim().ifBlank {
            "custom." + cleanLabel.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_').ifBlank { "field" }
        }
        val env = runCatching { cipher.profileEnvelope() }.getOrNull() ?: return
        val existingList = env["details"]?.jsonArray.orEmpty().map { it.jsonObject }.toMutableList()

        if (detailId != null) {
            val idx = existingList.indexOfFirst { it["id"]?.jsonPrimitive?.contentOrNull == detailId }
            if (idx >= 0) {
                val curr = existingList[idx]
                val chosenId = curr["chosenVariantId"]?.jsonPrimitive?.contentOrNull
                val variants = curr["variants"]?.jsonArray.orEmpty().map { it.jsonObject }.toMutableList()
                val targetVarIdx = variants.indexOfFirst { it["id"]?.jsonPrimitive?.contentOrNull == chosenId }
                    .let { if (it >= 0) it else 0 }
                if (variants.isNotEmpty()) {
                    val vMap = variants[targetVarIdx].toMutableMap()
                    vMap["value"] = JsonPrimitive(cleanValue)
                    if (!script.isNullOrBlank()) vMap["script"] = JsonPrimitive(script)
                    variants[targetVarIdx] = JsonObject(vMap)
                }
                val dMap = curr.toMutableMap()
                dMap["label"] = JsonPrimitive(cleanLabel)
                dMap["attribute"] = JsonPrimitive(cleanAttr)
                dMap["agentRule"] = JsonPrimitive(agentRule)
                dMap["variants"] = JsonArray(variants)
                existingList[idx] = JsonObject(dMap)
            }
        } else {
            val varId = UUID.randomUUID().toString()
            existingList.add(
                buildJsonObject {
                    put("id", UUID.randomUUID().toString())
                    put("attribute", cleanAttr)
                    put("label", cleanLabel)
                    put("valueType", "text")
                    put("chosenVariantId", varId)
                    put("agentRule", agentRule)
                    put(
                        "variants",
                        JsonArray(
                            listOf(
                                buildJsonObject {
                                    put("id", varId)
                                    put("script", script?.takeIf { it.isNotBlank() }?.let(::JsonPrimitive) ?: JsonNull)
                                    put("tag", JsonNull)
                                    put("value", cleanValue)
                                    put("current", true)
                                    put("sourceId", JsonNull)
                                    put("locator", JsonNull)
                                    put("verified", false)
                                    put("origin", "typed")
                                },
                            ),
                        ),
                    )
                    put("history", JsonArray(emptyList()))
                    put("conflicts", JsonArray(emptyList()))
                },
            )
        }
        val nextEnv = JsonObject(env.toMutableMap().apply { put("details", JsonArray(existingList)) })
        saveCipher(cipher.withProfileEnvelope(nextEnv), statusMessage = "Saved detail")
    }

    fun deleteProfileDetail(cipher: CipherView, detailId: String) {
        val env = runCatching { cipher.profileEnvelope() }.getOrNull() ?: return
        val remaining = env["details"]?.jsonArray.orEmpty().filterNot {
            it.jsonObject["id"]?.jsonPrimitive?.contentOrNull == detailId
        }
        val nextEnv = JsonObject(env.toMutableMap().apply { put("details", JsonArray(remaining)) })
        saveCipher(cipher.withProfileEnvelope(nextEnv), statusMessage = "Removed detail")
    }

    // MARK: Source Page Bitmap Loader (Images + PDFs)

    suspend fun loadSourceBitmap(
        cipher: CipherView?,
        attachmentId: String,
        pageIndex: Int = 0,
        maxDim: Int = 1400,
    ): Bitmap? = withContext(Dispatchers.IO) {
        if (attachmentId.isBlank()) return@withContext null
        val cacheKey = "${cipher?.id.orEmpty()}:$attachmentId:$pageIndex:$maxDim"
        bitmapCache[cacheKey]?.let { return@withContext it }

        val userId = authRepository.userStateFlow.value?.activeAccount
            ?.takeIf { it.isLoggedIn && it.isVaultUnlocked }?.userId
        val plaintext = decryptLocalOriginal(userId, cipher, attachmentId)
            ?: downloadOriginal(userId, cipher, attachmentId)
        val decoded: Bitmap? = when {
            plaintext != null -> decodeAttachmentBytes(plaintext, pageIndex, maxDim)
            cipher != null -> {
                VowkeySampleWalkthrough.scenarioForCipher(cipher)?.let(VowkeySampleWalkthrough::renderSampleBitmap)
            }
            else -> null
        }
        if (decoded != null) {
            if (bitmapCache.size > 24) bitmapCache.clear()
            bitmapCache[cacheKey] = decoded
        }
        decoded
    }

    private suspend fun retainAccountOriginals(userId: String, ciphers: List<CipherView>): Boolean {
        var complete = true
        for (cipher in ciphers) {
            if (!currentCoroutineContext().isActive) return false
            val cipherId = cipher.id ?: continue
            val live = cipher.attachments.orEmpty().mapNotNull { it.id }.toSet()
            for (stored in localStore.accountOriginals(userId, cipherId).subtract(live)) {
                runCatching { localStore.encryptedOriginal(userId, cipherId, stored).delete() }
            }
            if (live.isEmpty()) localStore.deleteAccountOriginals(userId, cipherId)
            for (attachmentId in live) {
                if (!currentCoroutineContext().isActive) return false
                if (localStore.readEncryptedOriginal(userId, cipherId, attachmentId) != null) continue
                if (downloadOriginal(userId, cipher, attachmentId) == null) complete = false
            }
        }
        return complete
    }

    private suspend fun decryptLocalOriginal(userId: String?, cipher: CipherView?, attachmentId: String): ByteArray? {
        val cipherId = cipher?.id ?: return null
        val resolvedId = resolveAttachmentId(cipher, attachmentId) ?: return null
        val encrypted = userId?.let { localStore.readEncryptedOriginal(it, cipherId, resolvedId) }
            ?: localPlaintext(attachmentId)
            ?: return null
        if (encrypted === localPlaintext(attachmentId) || userId == null) return encrypted
        val cipherRecord = vaultDiskSource.getCipher(userId, cipherId)?.toEncryptedSdkCipher() ?: return null
        val attachment = cipher.attachments?.firstOrNull { it.id == resolvedId } ?: return null
        val encryptedFile = File(appContext.cacheDir, "$resolvedId.enc")
        val decryptedFile = File(appContext.cacheDir, "$resolvedId.dec")
        return runCatching {
            encryptedFile.writeBytes(encrypted)
            vaultSdkSource.decryptFile(
                userId = userId,
                cipher = cipherRecord,
                attachmentView = attachment,
                encryptedFilePath = encryptedFile.path,
                decryptedFilePath = decryptedFile.path,
            ).getOrThrow()
            decryptedFile.readBytes()
        }.getOrNull().also {
            encryptedFile.delete()
            decryptedFile.delete()
        }
    }

    private fun localPlaintext(attachmentId: String): ByteArray? {
        val file = runCatching { localStore.attachmentFile(attachmentId) }.getOrNull()
        return if (file?.isFile == true && file.length() > 0) file.readBytes() else null
    }

    private suspend fun downloadOriginal(userId: String?, cipher: CipherView?, attachmentId: String): ByteArray? {
        if (cipher == null || userId == null || VowkeySampleWalkthrough.isSampleCipher(cipher)) return null
        val resolvedId = resolveAttachmentId(cipher, attachmentId) ?: return null
        val downloaded = runCatching {
            vaultRepository.downloadAttachment(cipherView = cipher, attachmentId = resolvedId)
        }.getOrNull()
        if (downloaded is DownloadAttachmentResult.Success) downloaded.file.delete()
        return decryptLocalOriginal(userId, cipher, resolvedId)
    }

    private fun resolveAttachmentId(cipher: CipherView, attachmentId: String): String? {
        val envSources = runCatching { cipher.profileEnvelope()?.get("sources")?.jsonArray }.getOrNull().orEmpty()
        val matchedSourceName = envSources.firstOrNull { el ->
            val obj = el as? JsonObject
            obj?.get("attachmentId")?.jsonPrimitive?.contentOrNull == attachmentId ||
                obj?.get("id")?.jsonPrimitive?.contentOrNull == attachmentId
        }?.jsonObject?.get("fileName")?.jsonPrimitive?.contentOrNull
        return cipher.attachments?.firstOrNull { it.id == attachmentId }?.id
            ?: matchedSourceName?.let { targetName ->
                cipher.attachments?.firstOrNull {
                    it.fileName == targetName || it.fileName.equals(targetName, ignoreCase = true)
                }?.id
            }
            ?: cipher.attachments?.singleOrNull()?.id
    }

    private fun decodeAttachmentBytes(bytes: ByteArray, pageIndex: Int, maxDim: Int): Bitmap? {
        val isPdf = bytes.size >= 5 && String(bytes, 0, 5, Charsets.US_ASCII) == "%PDF-"
        if (isPdf) {
            val temp = File.createTempFile("vk-page", ".pdf", appContext.cacheDir)
            return runCatching {
                temp.writeBytes(bytes)
                ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
                    PdfRenderer(pfd).use { renderer ->
                        if (renderer.pageCount <= 0) return@use null
                        val safeIdx = pageIndex.coerceIn(0, renderer.pageCount - 1)
                        renderer.openPage(safeIdx).use { page ->
                            val scale = (maxDim.toFloat() / max(page.width, page.height).coerceAtLeast(1))
                                .coerceIn(1f, 3f)
                            val w = (page.width * scale).roundToInt().coerceAtLeast(1)
                            val h = (page.height * scale).roundToInt().coerceAtLeast(1)
                            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                            Canvas(bmp).drawColor(AndroidColor.WHITE)
                            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            bmp
                        }
                    }
                }
            }.getOrNull().also { temp.delete() }
        }
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
        var sample = 1
        while (max(bounds.outWidth / sample, bounds.outHeight / sample) > maxDim * 2) sample *= 2
        return BitmapFactory.decodeByteArray(
            bytes, 0, bytes.size,
            BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.ARGB_8888
            },
        )
    }

    private fun inferProfileName(details: Map<String, String>, fallback: String): String =
        details["name.full.latin"]
            ?: details["name.full"]
            ?: listOfNotNull(
                details["name.family.latin"] ?: details["name.family"],
                details["name.given.latin"] ?: details["name.given"],
            ).joinToString(" ").takeIf { it.isNotBlank() }
            ?: fallback

    // MARK: Debug Automation Hook for Emulator Verification

    private fun runDebugAutoIfPresent() {
        if (!BuildConfig.DEBUG) return
        val dir = appContext.externalCacheDir ?: appContext.cacheDir
        val specFile = File(dir, "vk_ws_auto.json")
        if (!specFile.exists()) return
        val raw = runCatching { specFile.readText() }.getOrNull() ?: return
        specFile.delete()
        viewModelScope.launch {
            runCatching {
                val spec = json.parseToJsonElement(raw).jsonObject
                spec["tab"]?.jsonPrimitive?.contentOrNull?.let { t ->
                    VowkeyTab.entries.firstOrNull { it.name.equals(t, ignoreCase = true) }?.let(::selectTab)
                }
                if (spec["loadAllSamples"]?.jsonPrimitive?.booleanOrNull == true) {
                    withContext(Dispatchers.IO) {
                        localStore.unlock()
                        for (s in VowkeySampleWalkthrough.scenarios) {
                            if (localStore.items().none { VowkeySampleWalkthrough.scenarioForCipher(it)?.id == s.id }) {
                                writeSampleScenarioToStore(s)
                            }
                        }
                    }
                }
                if (spec["clearSamples"]?.jsonPrimitive?.booleanOrNull == true) {
                    clearSampleData()
                }
                val readPaths = spec["readPaths"]?.jsonArray.orEmpty().mapNotNull { it.jsonPrimitive.contentOrNull }
                var capturedId: String? = null
                for (path in readPaths) {
                    val f = File(path)
                    if (!f.exists()) continue
                    val mime = guessMimeType(f.name)
                    val res = decision.readDocumentBytes(f.readBytes(), f.name, mime, appContext.cacheDir)
                    if (res.details.isNotEmpty()) {
                        val c = newCapturedNativeProfile(
                            inferProfileName(res.details, f.nameWithoutExtension),
                            res.details,
                            res.locators,
                            res.sourceRecord,
                            origin = "ocr",
                        )
                        capturedId = persistCipher(c)
                    }
                }
                val (active, deleted) = withContext(Dispatchers.IO) { loadActiveAndDeletedItems() }
                _uiState.update { it.copy(items = active, deletedItems = deleted) }

                spec["openSampleId"]?.jsonPrimitive?.contentOrNull?.let { sid ->
                    val match = active.firstOrNull { VowkeySampleWalkthrough.scenarioForCipher(it)?.id == sid }
                    if (match != null) _uiState.update { it.copy(selectedCipherId = match.id) }
                }
                spec["fillPath"]?.jsonPrimitive?.contentOrNull?.let { fp ->
                    val formFile = File(fp)
                    if (formFile.exists()) {
                        val targetProfId = capturedId ?: active.firstOrNull { it.type == CipherType.IDENTITY }?.id
                        val filled = decision.fillFormBytes(
                            bytes = formFile.readBytes(),
                            fileName = formFile.name,
                            mediaType = guessMimeType(formFile.name),
                            cacheDir = appContext.cacheDir,
                            profiles = active.filter { it.type == CipherType.IDENTITY },
                            selectedProfileId = targetProfId,
                        )
                        _uiState.update {
                            it.copy(
                                showFillForm = true,
                                fillFormProfileId = targetProfId,
                                filledResult = filled,
                            )
                        }
                    }
                }
            }
        }
    }

    companion object {
        fun guessMimeType(fileName: String): String = when (fileName.substringAfterLast('.', "").lowercase()) {
            "pdf" -> "application/pdf"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "docx" -> "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            "xlsx" -> "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            "hwpx" -> "application/hwp+zip"
            else -> "application/octet-stream"
        }
    }
}
