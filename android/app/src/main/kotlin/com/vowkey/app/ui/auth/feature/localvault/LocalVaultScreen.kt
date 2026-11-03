package com.vowkey.app.ui.auth.feature.localvault

import androidx.activity.compose.BackHandler
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.vowkey.app.R
import com.vowkey.app.data.autofill.accessibility.manager.AccessibilitySelectionManager
import com.vowkey.app.data.autofill.manager.AutofillSelectionManager
import com.vowkey.app.data.autofill.model.AutofillSaveItem
import com.vowkey.app.data.autofill.model.AutofillSelectionData
import com.vowkey.app.data.platform.manager.SpecialCircumstanceManager
import com.vowkey.app.data.platform.manager.model.SpecialCircumstance
import com.vowkey.app.data.platform.util.subtitle
import com.vowkey.app.data.vault.datasource.disk.*
import com.vowkey.app.ui.vault.feature.secrets.SecretsRoute
import com.vowkey.app.ui.vault.feature.secrets.SecretsScreen
import com.vowkey.app.ui.vault.util.secretsKind
import com.vowkey.ui.platform.composition.LocalExitManager
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.row.VowkeyPushRow
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.vault.*
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import java.time.Year
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.*

@Serializable
data object LocalVaultRoute

fun NavGraphBuilder.localVaultDestination(onBack: () -> Unit) {
    composable<LocalVaultRoute> { LocalVaultScreen(onBack = onBack) }
}

internal sealed interface LocalVaultCompletion {
    data object Saved : LocalVaultCompletion
}

private class NoDetailsReadException : IllegalStateException()

@HiltViewModel
internal class LocalVaultViewModel @Inject constructor(
    private val store: LocalVaultStore,
    private val decision: GuestDecision,
    private val specialCircumstanceManager: SpecialCircumstanceManager,
    private val autofillSelectionManager: AutofillSelectionManager,
    private val accessibilitySelectionManager: AccessibilitySelectionManager,
) : ViewModel() {
    private val stateFlow = MutableStateFlow(emptyList<CipherView>())
    val items = stateFlow.asStateFlow()
    val selected = MutableStateFlow<CipherView?>(null)
    val messageRes = MutableStateFlow<Int?>(null)
    val capturing = MutableStateFlow(false)
    private val completions = Channel<LocalVaultCompletion>(Channel.BUFFERED)
    val completionFlow = completions.receiveAsFlow()
    private val request = specialCircumstanceManager.specialCircumstance
    val isExternalRequest = request is SpecialCircumstance.AutofillSelection ||
        request is SpecialCircumstance.AutofillSave
    val isSelecting = request is SpecialCircumstance.AutofillSelection
    val requestedType = when (request) {
        is SpecialCircumstance.AutofillSelection -> when (request.autofillSelectionData.type) {
            AutofillSelectionData.Type.LOGIN -> CipherType.LOGIN
            AutofillSelectionData.Type.CARD -> CipherType.CARD
            AutofillSelectionData.Type.IDENTITY -> CipherType.IDENTITY
        }
        else -> CipherType.LOGIN
    }

    init {
        reload()
        when (request) {
            is SpecialCircumstance.AutofillSave -> selected.value = request.autofillSaveItem.toLocalCipher()
            else -> Unit
        }
    }

    fun reload() {
        runCatching { store.unlock(); store.items() }
            .onSuccess { stateFlow.value = it.filter { cipher -> cipher.deletedDate == null && cipher.archivedDate == null } }
            .onFailure { messageRes.value = R.string.vk_local_open_error }
    }

    fun open(id: String?, type: CipherType = requestedType) {
        selected.value = id?.let(store::item) ?: when (type) {
            CipherType.IDENTITY -> newNativeProfile("", mapOf("name.given" to "", "name.family" to "", "contact.email" to "", "contact.phone" to "", "address.street" to "", "address.city" to "", "address.country" to ""), origin = "typed")
            CipherType.CARD -> newNativeCipher(type).copy(card = CardView(null, null, null, null, null, null))
            else -> newNativeCipher(CipherType.LOGIN).copy(login = newNativeLogin())
        }
    }

    fun select(cipher: CipherView) {
        if (isSelecting && !cipher.isNativeProfileUsableForFill()) {
            messageRes.value = R.string.vk_profile_not_ready
            return
        }
        when (val current = request) {
            is SpecialCircumstance.AutofillSelection -> when (current.autofillSelectionData.framework) {
                AutofillSelectionData.Framework.AUTOFILL -> autofillSelectionManager.emitAutofillSelection(cipher)
                AutofillSelectionData.Framework.ACCESSIBILITY -> accessibilitySelectionManager.emitAccessibilitySelection(cipher)
            }
            else -> open(cipher.id)
        }
    }

    fun save(updated: CipherView) {
        runCatching { store.save(updated) }.onSuccess {
            selected.value = null
            reload()
            when (request) {
                is SpecialCircumstance.AutofillSave -> {
                    specialCircumstanceManager.specialCircumstance = null
                    completions.trySend(LocalVaultCompletion.Saved)
                }
                else -> Unit
            }
        }.onFailure { messageRes.value = R.string.vk_item_save_error }
    }

    fun capture(name: String, text: String) {
        viewModelScope.launch {
            runCatching {
                val reading = buildJsonObject {
                    put("pages", JsonArray(listOf(buildJsonObject {
                        put("pieces", JsonArray(text.lines().filter { it.isNotBlank() }.map { line ->
                            buildJsonObject { put("text", line) }
                        }))
                    })))
                }
                val captured = decision.document(reading, Year.now().value).jsonObject
                val details = captured["details"]?.jsonObject ?: throw NoDetailsReadException()
                if (details.isEmpty()) throw NoDetailsReadException()
                store.save(newNativeProfile(name, details.mapValues { it.value.jsonPrimitive.content }))
            }.onSuccess { capturing.value = false; reload(); messageRes.value = null }
                .onFailure { error ->
                    messageRes.value = if (error is NoDetailsReadException) {
                        R.string.vk_no_details_read
                    } else {
                        R.string.vk_reader_unavailable
                    }
                }
        }
    }

    fun closeEditor() { selected.value = null; capturing.value = false }
    fun lock() = store.lock()
}

private fun AutofillSaveItem.toLocalCipher(): CipherView = when (this) {
    is AutofillSaveItem.Login -> newNativeCipher(CipherType.LOGIN).copy(
        name = uri.orEmpty(),
        login = newNativeLogin().copy(username = username, password = password,
            uris = uri?.let { listOf(LoginUriView(it, null, null)) }.orEmpty()),
    )
    is AutofillSaveItem.Card -> newNativeCipher(CipherType.CARD).copy(
        name = cardholderName.orEmpty(),
        card = CardView(cardholderName, expirationMonth, expirationYear, code = securityCode, brand = brand, number = number),
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LocalVaultScreen(onBack: () -> Unit, model: LocalVaultViewModel = hiltViewModel()) {
    val items by model.items.collectAsState()
    val item by model.selected.collectAsState()
    val messageRes by model.messageRes.collectAsState()
    val capturing by model.capturing.collectAsState()
    var secretRoute by remember { mutableStateOf<SecretsRoute?>(null) }
    val exit = LocalExitManager.current
    LaunchedEffect(model) {
        model.completionFlow.collect { completion -> when (completion) {
            LocalVaultCompletion.Saved -> exit.exitApplication()
        } }
    }
    secretRoute?.let { route ->
        SecretsScreen(route.kind, route.id, onBack = { secretRoute = null; model.reload() })
        return
    }
    val back = {
        if (item != null || capturing) model.closeEditor()
        else if (model.isExternalRequest) exit.exitApplication() else onBack()
    }
    BackHandler(onBack = back)
    VowkeyScaffold(topBar = {
        VowkeyMediumTopAppBar(
            title = stringResource(VowkeyString.vault),
            navigationIcon = NavigationIcon(rememberVectorPainter(VowkeyDrawable.ic_back), stringResource(VowkeyString.back), back),
        )
    }) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
            messageRes?.let { Text(stringResource(it)) }
            when {
                capturing -> {
                    var name by remember { mutableStateOf("") }
                    var text by remember { mutableStateOf("") }
                    VowkeyTextField(value = name, onValueChange = { name = it }, cardStyle = CardStyle.Full, label = stringResource(VowkeyString.name))
                    VowkeyTextField(value = text, onValueChange = { text = it }, cardStyle = CardStyle.Full, singleLine = false, label = stringResource(R.string.vk_document_text))
                    VowkeyFilledButton(stringResource(R.string.vk_read_document), { model.capture(name, text) })
                }
                item != null -> LocalEditor(checkNotNull(item), model::save)
                else -> {
                    val shown = items.filter { !model.isSelecting || it.type == model.requestedType }
                    if (shown.isEmpty()) Text(stringResource(R.string.vk_local_empty))
                    shown.forEach { cipher ->
                        VowkeyPushRow(text = cipher.name, description = cipher.subtitle, onClick = {
                            val kind = cipher.type.secretsKind()
                            if (kind == null) model.select(cipher) else secretRoute = SecretsRoute(kind, cipher.id)
                        }, cardStyle = CardStyle.Full)
                    }
                    VowkeyFilledButton(stringResource(VowkeyString.add_item), { model.open(null) })
                    if (!model.isSelecting) {
                        VowkeyTextButton(stringResource(R.string.vk_add_profile), { model.open(null, CipherType.IDENTITY) })
                        VowkeyTextButton(stringResource(R.string.vk_add_card), { model.open(null, CipherType.CARD) })
                        VowkeyTextButton(stringResource(R.string.vk_keys), { secretRoute = SecretsRoute("key") })
                        VowkeyTextButton(stringResource(R.string.vk_environments), { secretRoute = SecretsRoute("environment") })
                    }
                    VowkeyTextButton(stringResource(R.string.vk_read_document), { model.capturing.value = true })
                    VowkeyTextButton(stringResource(R.string.vk_local_lock), { model.lock(); back() })
                }
            }
        }
    }
}

@Composable
private fun LocalEditor(item: CipherView, onSave: (CipherView) -> Unit) {
    var name by remember(item) { mutableStateOf(item.name) }
    VowkeyTextField(value = name, onValueChange = { name = it }, cardStyle = CardStyle.Full, label = stringResource(VowkeyString.name))
    when (item.type) {
        CipherType.IDENTITY -> {
            val meta = remember(item) { runCatching { item.profileEnvelope() }.getOrNull() }
            if (meta == null) {
                Text(stringResource(R.string.vk_profile_unreadable))
            } else {
                val details = remember(meta) { meta.getValue("details").jsonArray.map { it.jsonObject } }
                val values = remember(item) { mutableStateMapOf<String, String>().apply {
                    details.forEach { detail ->
                        val detailId = detail.getValue("id").jsonPrimitive.content
                        detail.getValue("variants").jsonArray.forEach { entry ->
                            val variant = entry.jsonObject
                            put("$detailId/${variant.getValue("id").jsonPrimitive.content}", variant.getValue("value").jsonPrimitive.content)
                        }
                    }
                } }
                details.forEach { detail ->
                    val detailId = detail.getValue("id").jsonPrimitive.content
                    val attribute = detail["attribute"]?.jsonPrimitive?.contentOrNull
                    detail.getValue("variants").jsonArray.map { it.jsonObject }
                        .filter { it["current"] == JsonPrimitive(true) }.forEach { variant ->
                            val id = "$detailId/${variant.getValue("id").jsonPrimitive.content}"
                            val format = variant["script"]?.jsonPrimitive?.contentOrNull ?: variant["tag"]?.jsonPrimitive?.contentOrNull
                            val detailLabel = localizedDetailLabel(attribute, detail["label"]?.jsonPrimitive?.content.orEmpty())
                            VowkeyTextField(value = values[id].orEmpty(), onValueChange = { values[id] = it }, cardStyle = CardStyle.Full,
                                label = if (format == null) detailLabel else "$detailLabel ($format)")
                        }
                }
                var label by remember(item) { mutableStateOf("") }
                var value by remember(item) { mutableStateOf("") }
                VowkeyTextField(value = label, onValueChange = { label = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_detail_label))
                VowkeyTextField(value = value, onValueChange = { value = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_detail_value))
                VowkeyFilledButton(stringResource(VowkeyString.save), {
                    var updated = item.editProfile(name, values)
                    if (label.isNotBlank()) updated = updated.addProfileDetail(label, value)
                    onSave(updated)
                })
            }
        }
        CipherType.CARD -> {
            var holder by remember(item) { mutableStateOf(item.card?.cardholderName.orEmpty()) }
            var number by remember(item) { mutableStateOf(item.card?.number.orEmpty()) }
            var month by remember(item) { mutableStateOf(item.card?.expMonth.orEmpty()) }
            var year by remember(item) { mutableStateOf(item.card?.expYear.orEmpty()) }
            var code by remember(item) { mutableStateOf(item.card?.code.orEmpty()) }
            VowkeyTextField(value = holder, onValueChange = { holder = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_cardholder_name))
            VowkeyTextField(value = number, onValueChange = { number = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_card_number))
            VowkeyTextField(value = month, onValueChange = { month = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_expiration_month))
            VowkeyTextField(value = year, onValueChange = { year = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_expiration_year))
            VowkeyTextField(value = code, onValueChange = { code = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_security_code))
            VowkeyFilledButton(stringResource(VowkeyString.save), { onSave(item.copy(name = name,
                card = item.card!!.copy(cardholderName = holder, number = number, expMonth = month, expYear = year, code = code))) })
        }
        else -> {
            var username by remember(item) { mutableStateOf(item.login?.username.orEmpty()) }
            var password by remember(item) { mutableStateOf(item.login?.password.orEmpty()) }
            var uri by remember(item) { mutableStateOf(item.login?.uris?.firstOrNull()?.uri.orEmpty()) }
            VowkeyTextField(value = username, onValueChange = { username = it }, cardStyle = CardStyle.Full, label = stringResource(VowkeyString.username))
            VowkeyTextField(value = password, onValueChange = { password = it }, cardStyle = CardStyle.Full, label = stringResource(VowkeyString.password))
            VowkeyTextField(value = uri, onValueChange = { uri = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_login_uri))
            VowkeyFilledButton(stringResource(VowkeyString.save), { onSave(item.copy(name = name,
                login = (item.login ?: newNativeLogin()).copy(username = username, password = password,
                    uris = uri.takeIf { it.isNotBlank() }?.let { listOf(LoginUriView(it, null, null)) }.orEmpty()))) })
        }
    }
}

@StringRes
private fun attributeStringRes(attribute: String?): Int? = when (attribute) {
    "name.full" -> R.string.vk_attr_full_name
    "name.family" -> R.string.vk_attr_family_name
    "name.given" -> R.string.vk_attr_given_name
    "birth.date" -> R.string.vk_attr_birth_date
    "birth.place" -> R.string.vk_attr_birth_place
    "person.sex" -> R.string.vk_attr_sex
    "person.nationality" -> R.string.vk_attr_nationality
    "address.full" -> R.string.vk_attr_current_address
    "address.street" -> R.string.vk_attr_street
    "address.city" -> R.string.vk_attr_city
    "address.postal" -> R.string.vk_attr_postal_code
    "address.country" -> R.string.vk_attr_country
    "contact.phone", "contact.phone.mobile" -> R.string.vk_attr_phone_number
    "contact.email" -> R.string.vk_attr_email_address
    "id.passport.number" -> R.string.vk_attr_passport_number
    "id.passport.expiry" -> R.string.vk_attr_passport_expiry
    "id.card.number" -> R.string.vk_attr_id_card_number
    "id.card.expiry" -> R.string.vk_attr_expiry_date
    "id.residence_card.number" -> R.string.vk_attr_residence_card_number
    "id.national.number" -> R.string.vk_attr_national_id_number
    "id.driver_license.number" -> R.string.vk_attr_driver_license_number
    "work.employer.name" -> R.string.vk_attr_employer
    "person.profession" -> R.string.vk_attr_occupation
    "bank.name" -> R.string.vk_attr_bank_name
    "bank.branch.name" -> R.string.vk_attr_branch_name
    "bank.account.number" -> R.string.vk_attr_account_number
    else -> null
}

@Composable
private fun localizedDetailLabel(attribute: String?, fallback: String): String {
    val resId = attributeStringRes(attribute)
    val canonical = attribute?.let { humanDetailLabel(it) }.orEmpty()
    return if (resId != null && (fallback.isBlank() || fallback == attribute || fallback == canonical)) {
        stringResource(resId)
    } else {
        fallback.ifBlank { canonical }
    }
}
