package com.vowkey.app.ui.auth.feature.environment

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.platform.components.dialog.VowkeyClientCertificateDialog
import com.vowkey.app.ui.platform.composition.LocalKeyChainManager
import com.vowkey.app.ui.platform.manager.keychain.KeyChainManager
import kotlinx.coroutines.launch

/**
 * Displays the about self-hosted/custom environment screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnvironmentScreen(
    onNavigateBack: () -> Unit,
    intentManager: IntentManager = LocalIntentManager.current,
    keyChainManager: KeyChainManager = LocalKeyChainManager.current,
    viewModel: EnvironmentViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val certificateImportFilePickerLauncher = intentManager.getActivityResultLauncher { result ->
        intentManager.getFileDataFromActivityResult(result)?.let {
            viewModel.trySendAction(EnvironmentAction.ImportCertificateFilePickerResultReceive(it))
        }
    }
    val scope = rememberCoroutineScope()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is EnvironmentEvent.NavigateBack -> onNavigateBack.invoke()
            is EnvironmentEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            is EnvironmentEvent.ShowCertificateImportFileChooser -> {
                certificateImportFilePickerLauncher.launch(
                    intentManager.createFileChooserIntent(withCameraIntents = false),
                )
            }

            is EnvironmentEvent.ShowSystemCertificateSelectionDialog -> {
                scope.launch {
                    val result = keyChainManager.choosePrivateKeyAlias(
                        currentServerUrl = event.serverUrl?.takeUnless { it.isEmpty() },
                    )
                    viewModel.trySendAction(
                        action = EnvironmentAction.SystemCertificateSelectionResultReceive(result),
                    )
                }
            }
        }
    }

    when (val dialog = state.dialog) {
        is EnvironmentState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.an_error_has_occurred),
                message = dialog.message(),
                onDismissRequest = { viewModel.trySendAction(EnvironmentAction.DialogDismiss) },
                throwable = dialog.throwable,
            )
        }

        is EnvironmentState.DialogState.SetCertificateData -> {
            VowkeyClientCertificateDialog(
                onConfirmClick = { alias, password ->
                    viewModel.trySendAction(
                        EnvironmentAction.SetCertificateInfoResultReceive(
                            certificateFileData = dialog.certificateBytes,
                            password = password,
                            alias = alias,
                        ),
                    )
                },
                onDismissRequest = {
                    viewModel.trySendAction(EnvironmentAction.SetCertificatePasswordDialogDismiss)
                },
            )
        }

        is EnvironmentState.DialogState.SystemCertificateWarningDialog -> {
            @Suppress("MaxLineLength")
            VowkeyTwoButtonDialog(
                title = stringResource(VowkeyString.warning),
                message = stringResource(
                    VowkeyString.system_certificates_are_not_as_secure_as_importing_certificates_to_vowkey,
                ),
                confirmButtonText = stringResource(VowkeyString.continue_text),
                onConfirmClick = {
                    viewModel.trySendAction(EnvironmentAction.ConfirmChooseSystemCertificateClick)
                },
                dismissButtonText = stringResource(VowkeyString.cancel),
                onDismissClick = { viewModel.trySendAction(EnvironmentAction.DialogDismiss) },
                onDismissRequest = { viewModel.trySendAction(EnvironmentAction.DialogDismiss) },
            )
        }

        is EnvironmentState.DialogState.ConfirmOverwriteAlias -> {
            VowkeyTwoButtonDialog(
                title = dialog.title(),
                message = dialog.message(),
                confirmButtonText = stringResource(VowkeyString.replace_certificate),
                dismissButtonText = stringResource(VowkeyString.cancel),
                onConfirmClick = {
                    viewModel.trySendAction(
                        EnvironmentAction.ConfirmOverwriteCertificateClick(
                            triggeringAction = dialog.triggeringAction,
                        ),
                    )
                },
                onDismissClick = { viewModel.trySendAction(EnvironmentAction.DialogDismiss) },
                onDismissRequest = { viewModel.trySendAction(EnvironmentAction.DialogDismiss) },
            )
        }

        null -> Unit
    }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.settings),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(EnvironmentAction.CloseClick) },
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        onClick = { viewModel.trySendAction(EnvironmentAction.SaveClick) },
                        modifier = Modifier.testTag("SaveButton"),
                    )
                },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.self_hosted_environment),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))

            VowkeyTextField(
                label = stringResource(id = VowkeyString.server_url),
                value = state.serverUrl,
                placeholder = "ex. https://vowkey.company.com",
                supportingText = stringResource(
                    id = VowkeyString.self_hosted_environment_footer,
                ),
                onValueChange = { viewModel.trySendAction(EnvironmentAction.ServerUrlChange(it)) },
                autoCompleteOptions = state.autocompleteEnvironments,
                keyboardType = KeyboardType.Uri,
                textFieldTestTag = "ServerUrlEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(16.dp))

            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.custom_environment),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))

            VowkeyTextField(
                label = stringResource(id = VowkeyString.web_vault_url),
                value = state.webVaultServerUrl,
                onValueChange = {
                    viewModel.trySendAction(EnvironmentAction.WebVaultServerUrlChange(it))
                },
                keyboardType = KeyboardType.Uri,
                textFieldTestTag = "WebVaultUrlEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))

            VowkeyTextField(
                label = stringResource(id = VowkeyString.api_url),
                value = state.apiServerUrl,
                onValueChange = {
                    viewModel.trySendAction(EnvironmentAction.ApiServerUrlChange(it))
                },
                keyboardType = KeyboardType.Uri,
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("ApiUrlEntry")
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))

            VowkeyTextField(
                label = stringResource(id = VowkeyString.identity_url),
                value = state.identityServerUrl,
                onValueChange = {
                    viewModel.trySendAction(EnvironmentAction.IdentityServerUrlChange(it))
                },
                keyboardType = KeyboardType.Uri,
                textFieldTestTag = "IdentityUrlEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))

            VowkeyTextField(
                label = stringResource(id = VowkeyString.icons_url),
                value = state.iconsServerUrl,
                onValueChange = {
                    viewModel.trySendAction(EnvironmentAction.IconsServerUrlChange(it))
                },
                supportingText = stringResource(id = VowkeyString.custom_environment_footer),
                keyboardType = KeyboardType.Uri,
                textFieldTestTag = "IconsUrlEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 16.dp))

            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.client_certificate_mtls),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))

            VowkeyTextField(
                label = stringResource(id = VowkeyString.certificate_alias),
                value = state.keyAlias,
                supportingText = stringResource(
                    id = VowkeyString.certificate_used_for_client_authentication,
                ),
                onValueChange = {},
                readOnly = true,
                cardStyle = CardStyle.Full,
                textFieldTestTag = "KeyAliasEntry",
                modifier = Modifier
                    .fillMaxWidth()
                    .focusProperties { canFocus = false }
                    .standardHorizontalMargin(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))

            VowkeyFilledButton(
                label = stringResource(id = VowkeyString.import_certificate),
                onClick = { viewModel.trySendAction(EnvironmentAction.ImportCertificateClick) },
                isExternalLink = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("ImportCertificateButton"),
            )

            Spacer(modifier = Modifier.height(height = 12.dp))

            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.choose_system_certificate),
                onClick = {
                    viewModel.trySendAction(EnvironmentAction.ChooseSystemCertificateClick)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("ChooseSystemCertificateButton"),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
