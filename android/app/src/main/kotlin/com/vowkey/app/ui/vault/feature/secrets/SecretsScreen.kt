package com.vowkey.app.ui.vault.feature.secrets

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import androidx.navigation.toRoute
import com.vowkey.app.R
import com.vowkey.app.data.platform.util.subtitle
import com.vowkey.app.data.vault.datasource.disk.LocalVaultStore
import com.vowkey.app.data.vault.manager.CipherManager
import com.vowkey.app.data.vault.manager.model.GetCipherResult
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.data.vault.repository.model.CreateCipherResult
import com.vowkey.app.data.vault.repository.model.UpdateCipherResult
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
import com.vowkey.vault.ApiKeyView
import com.vowkey.vault.CipherListViewType
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import com.vowkey.vault.EnvironmentMember
import com.vowkey.vault.EnvironmentView
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data class SecretsRoute(val kind: String = "key", val id: String? = null)

fun NavGraphBuilder.secretsDestination(onBack: () -> Unit) {
    composable<SecretsRoute> { entry ->
        val route = entry.toRoute<SecretsRoute>()
        SecretsScreen(route.kind, route.id, onBack)
    }
}

private class EnvironmentFormatException : IllegalArgumentException("Write each variable as NAME= followed by a saved @vk: key tag.")
private class EnvironmentKeyRefException : IllegalStateException("Link each variable to a saved @vk: key tag instead of a raw value.")
private class EnvironmentDuplicateException : IllegalArgumentException("Give each variable a unique name.")
private class InvalidSendStyleException : IllegalArgumentException("Choose bearer, header, or basic.")

@HiltViewModel
internal class SecretsViewModel @Inject constructor(
    private val ciphers: CipherManager,
    private val vault: VaultRepository,
    private val guest: LocalVaultStore,
    private val auth: com.vowkey.app.data.auth.datasource.disk.AuthDiskSource,
    private val sdk: com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource,
) : ViewModel() {
    private val records = MutableStateFlow(emptyList<CipherView>())
    val items = records.asStateFlow()
    private val keyChoices = MutableStateFlow(emptyList<CipherView>())
    val availableKeys = keyChoices.asStateFlow()
    private val selected = MutableStateFlow<CipherView?>(null)
    val item = selected.asStateFlow()
    val messageRes = MutableStateFlow<Int?>(null)

    fun load(kind: String, selectedId: String? = null) {
        viewModelScope.launch {
            runCatching {
                val wanted = if (kind == "environment") CipherType.ENVIRONMENT else CipherType.API_KEY
                val listType = if (kind == "environment") CipherListViewType.Environment else CipherListViewType.ApiKey
                val allAccount = vault.decryptCipherListResultStateFlow.value.data?.successes.orEmpty()
                val account = allAccount
                    .filter { it.type == listType }
                    .mapNotNull { row -> row.id?.let { ciphers.getCipher(it) }?.let { it as? GetCipherResult.Success }?.cipherView }
                val accountKeys = if (kind == "environment") {
                    allAccount
                        .filter { it.type == CipherListViewType.ApiKey }
                        .mapNotNull { row -> row.id?.let { ciphers.getCipher(it) }?.let { it as? GetCipherResult.Success }?.cipherView }
                } else {
                    emptyList()
                }
                val userId = auth.userState?.activeUserId
                val local = if (userId == null) {
                    guest.unlock()
                    guest.items()
                } else {
                    val key = android.util.Base64.decode(sdk.getUserEncryptionKey(userId).getOrThrow(), android.util.Base64.DEFAULT)
                    try { guest.accountPending(userId, key) } finally { key.fill(0) }
                }
                records.value = account + local.filter { it.type == wanted && account.none { saved -> saved.id == it.id } }
                if (kind == "environment") {
                    keyChoices.value = accountKeys + local.filter {
                        it.type == CipherType.API_KEY && accountKeys.none { saved -> saved.id == it.id }
                    }
                }
                if (selectedId != null) selected.value = records.value.firstOrNull { it.id == selectedId }
            }.onFailure { messageRes.value = R.string.vk_items_load_error }
        }
    }

    fun open(kind: String, id: String?) {
        messageRes.value = null
        selected.value = records.value.firstOrNull { it.id == id } ?: blank(kind)
    }

    fun close() {
        messageRes.value = null
        selected.value = null
    }

    fun save(kind: String, name: String, first: String, second: String, third: String, headerName: String, basicUsername: String) {
        val current = selected.value ?: return
        viewModelScope.launch {
            val saved = runCatching {
                val updated = current.edited(kind, name, first, second, third, headerName, basicUsername)
                if (current.id == null) {
                    ciphers.createCipher(updated)
                } else {
                    when (val result = ciphers.updateCipher(current.id.orEmpty(), updated)) {
                        UpdateCipherResult.Success -> CreateCipherResult.Success(current.id.orEmpty())
                        is UpdateCipherResult.Error -> CreateCipherResult.Error(error = result.error)
                    }
                }
            }.getOrElse { CreateCipherResult.Error(error = it) }
            messageRes.value = if (saved is CreateCipherResult.Error) {
                when (saved.error) {
                    is EnvironmentFormatException -> R.string.vk_env_format_error
                    is EnvironmentKeyRefException -> R.string.vk_env_key_ref_error
                    is EnvironmentDuplicateException -> R.string.vk_env_duplicate_name_error
                    is InvalidSendStyleException -> R.string.vk_key_send_style_error
                    else -> R.string.vk_item_save_error
                }
            } else {
                null
            }
            if (saved is CreateCipherResult.Success) {
                selected.value = null
                load(kind)
            }
        }
    }
}

private fun blank(kind: String): CipherView = if (kind == "environment") {
    com.vowkey.app.data.vault.datasource.disk.newNativeCipher(CipherType.ENVIRONMENT).copy(environment = EnvironmentView(members = emptyList()))
} else {
    com.vowkey.app.data.vault.datasource.disk.newNativeCipher(CipherType.API_KEY).copy(apiKey = ApiKeyView(value = "", sendStyle = "bearer", allowedHosts = emptyList(), headerName = null, basicUsername = null))
}

internal fun CipherView.edited(kind: String, name: String, first: String, second: String, third: String, headerName: String = apiKey?.headerName.orEmpty(), basicUsername: String = apiKey?.basicUsername.orEmpty()): CipherView {
    val kept = fields
    return if (kind == "environment") {
        val members = first.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.map { line ->
            val parts = line.split('=', limit = 2)
            if (parts.size != 2 || !parts[0].matches(Regex("[A-Za-z_][A-Za-z0-9_]*"))) {
                throw EnvironmentFormatException()
            }
            val itemId = Regex("@vk:([^/\\s]+)/key\\.value").matchEntire(parts[1])?.groupValues?.get(1)
                ?: throw EnvironmentKeyRefException()
            EnvironmentMember(name = parts[0], itemId = itemId)
        }.toList()
        if (members.map { it.name }.distinct().size != members.size) {
            throw EnvironmentDuplicateException()
        }
        copy(name = name, environment = EnvironmentView(members = members), fields = kept)
    } else {
        val style = second.ifBlank { "bearer" }
        if (style !in listOf("bearer", "header", "basic")) {
            throw InvalidSendStyleException()
        }
        copy(
            name = name,
            apiKey = (apiKey ?: ApiKeyView(value = null, sendStyle = null, allowedHosts = emptyList(), headerName = null, basicUsername = null)).copy(
                value = first,
                sendStyle = style,
                headerName = headerName.takeIf { style == "header" },
                basicUsername = basicUsername.takeIf { style == "basic" },
                allowedHosts = third.split(',').map { it.trim() }.filter { it.isNotEmpty() },
            ),
            fields = kept,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun SecretsScreen(kind: String, id: String?, onBack: () -> Unit, model: SecretsViewModel = hiltViewModel()) {
    val items by model.items.collectAsState()
    val availableKeys by model.availableKeys.collectAsState()
    val item by model.item.collectAsState()
    val messageRes by model.messageRes.collectAsState()
    LaunchedEffect(kind, id) { model.load(kind, id) }
    BackHandler { if (item == null) onBack() else model.close() }
    VowkeyScaffold(topBar = {
        VowkeyMediumTopAppBar(
            title = stringResource(if (kind == "environment") R.string.vk_environments else R.string.vk_keys),
            navigationIcon = NavigationIcon(rememberVectorPainter(VowkeyDrawable.ic_back), stringResource(VowkeyString.back)) {
                if (item == null) onBack() else model.close()
            },
        )
    }) {
        if (item == null) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                if (items.isEmpty()) Text(stringResource(R.string.vk_secrets_empty))
                messageRes?.let { Text(stringResource(it)) }
                items.forEach { cipher -> VowkeyPushRow(text = cipher.name, description = cipher.subtitle, onClick = { model.open(kind, cipher.id) }, cardStyle = CardStyle.Full) }
                VowkeyFilledButton(stringResource(VowkeyString.add_item), { model.open(kind, null) })
            }
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                messageRes?.let { Text(stringResource(it), Modifier.padding(16.dp)) }
                SecretEditor(kind, item!!, availableKeys, model::save)
            }
        }
    }
}

private fun suggestedEnvVarName(keyName: String): String {
    val cleaned = keyName.uppercase().replace(Regex("[^A-Z0-9]+"), "_").trim('_')
    return when {
        cleaned.isEmpty() -> "API_KEY"
        cleaned[0].isDigit() -> "KEY_$cleaned"
        else -> cleaned
    }
}

@Composable
private fun SecretEditor(
    kind: String,
    item: CipherView,
    availableKeys: List<CipherView>,
    onSave: (String, String, String, String, String, String, String) -> Unit,
) {
    val name = remember(item.id) { mutableStateOf(item.name) }
    val first = remember(item.id) {
        mutableStateOf(if (kind == "environment") item.environment?.members.orEmpty().joinToString("\n") { "${it.name}=@vk:${it.itemId}/key.value" } else item.apiKey?.value.orEmpty())
    }
    val second = remember(item.id) { mutableStateOf(item.apiKey?.sendStyle.orEmpty()) }
    val third = remember(item.id) { mutableStateOf(item.apiKey?.allowedHosts.orEmpty().joinToString(",")) }
    val headerName = remember(item.id) { mutableStateOf(item.apiKey?.headerName.orEmpty()) }
    val basicUsername = remember(item.id) { mutableStateOf(item.apiKey?.basicUsername.orEmpty()) }
    Column(Modifier.padding(16.dp)) {
        VowkeyTextField(value = name.value, onValueChange = { name.value = it }, cardStyle = CardStyle.Full, label = stringResource(VowkeyString.name))
        VowkeyTextField(value = first.value, onValueChange = { first.value = it }, cardStyle = CardStyle.Full, singleLine = kind != "environment", label = stringResource(if (kind == "environment") R.string.vk_members else R.string.vk_key_value))
        if (kind == "environment") {
            Text(stringResource(R.string.vk_env_members_hint), Modifier.padding(vertical = 8.dp))
            availableKeys.filter { !it.id.isNullOrBlank() }.forEach { keyCipher ->
                val keyId = keyCipher.id.orEmpty()
                val varName = suggestedEnvVarName(keyCipher.name)
                VowkeyTextButton(
                    label = stringResource(R.string.vk_env_insert_key, keyCipher.name.ifBlank { varName }),
                    onClick = {
                        val line = "$varName=@vk:$keyId/key.value"
                        first.value = if (first.value.isBlank()) line else "${first.value.trimEnd()}\n$line"
                    },
                )
            }
        }
        if (kind == "key") {
            VowkeyTextField(value = second.value, onValueChange = { second.value = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_send_style))
            VowkeyTextField(value = third.value, onValueChange = { third.value = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_allowed_hosts))
            if (second.value == "header") VowkeyTextField(value = headerName.value, onValueChange = { headerName.value = it }, cardStyle = CardStyle.Full, label = stringResource(R.string.vk_header_name))
            if (second.value == "basic") VowkeyTextField(value = basicUsername.value, onValueChange = { basicUsername.value = it }, cardStyle = CardStyle.Full, label = stringResource(VowkeyString.username))
        }
        VowkeyFilledButton(label = stringResource(VowkeyString.save), onClick = { onSave(kind, name.value, first.value, second.value, third.value, headerName.value, basicUsername.value) })
    }
}
