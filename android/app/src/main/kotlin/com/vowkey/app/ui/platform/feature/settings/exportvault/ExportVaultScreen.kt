package com.vowkey.app.ui.platform.feature.settings.exportvault

import android.net.Uri
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.card.VowkeyInfoCalloutCard
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.auth.feature.completeregistration.PasswordStrengthIndicator
import com.vowkey.app.ui.platform.feature.settings.exportvault.model.ExportVaultFormat
import com.vowkey.app.ui.platform.util.displayLabel
import kotlinx.collections.immutable.toImmutableList

/**
 * The top level composable for the Export Vault screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun ExportVaultScreen(
    onNavigateBack: () -> Unit,
    intentManager: IntentManager = LocalIntentManager.current,
    viewModel: ExportVaultViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val exportVaultLocationReceived: (Uri) -> Unit = remember {
        { viewModel.trySendAction(ExportVaultAction.ExportLocationReceive(it)) }
    }
    val fileSaverLauncher = intentManager.getActivityResultLauncher { activityResult ->
        intentManager.getFileDataFromActivityResult(activityResult)?.let {
            exportVaultLocationReceived.invoke(it.uri)
        }
    }
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            ExportVaultEvent.NavigateBack -> onNavigateBack()
            is ExportVaultEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            is ExportVaultEvent.NavigateToSelectExportDataLocation -> {
                fileSaverLauncher.launch(
                    intentManager.createDocumentIntent(
                        fileName = event.fileName,
                    ),
                )
            }
        }
    }

    var shouldShowConfirmationDialog by remember { mutableStateOf(false) }
    val confirmExportVaultClicked = {
        viewModel.trySendAction(ExportVaultAction.ConfirmExportVaultClicked)
    }
    if (shouldShowConfirmationDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.export_vault_confirmation_title),
            message = if (state.exportFormat == ExportVaultFormat.JSON_ENCRYPTED) {
                stringResource(id = VowkeyString.export_vault_file_pw_protect_info)
            } else {
                stringResource(
                    id = VowkeyString.export_vault_warning,
                )
            },
            confirmButtonText = stringResource(id = VowkeyString.export_vault),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowConfirmationDialog = false
                confirmExportVaultClicked()
            },
            onDismissClick = { shouldShowConfirmationDialog = false },
            onDismissRequest = { shouldShowConfirmationDialog = false },
        )
    }

    when (val dialog = state.dialogState) {
        is ExportVaultState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialog.title?.invoke(),
                message = dialog.message(),
                throwable = dialog.error,
                onDismissRequest = { viewModel.trySendAction(ExportVaultAction.DialogDismiss) },
            )
        }

        is ExportVaultState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialog.message())
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
                title = stringResource(id = VowkeyString.export_vault),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(ExportVaultAction.CloseButtonClick)
                },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        ExportVaultScreenContent(
            state = state,
            onConfirmFilePasswordInputChanged = {
                viewModel.trySendAction(ExportVaultAction.ConfirmFilePasswordInputChange(it))
            },
            onExportFormatOptionSelected = {
                viewModel.trySendAction(ExportVaultAction.ExportFormatOptionSelect(it))
            },
            onFilePasswordInputChanged = {
                viewModel.trySendAction(ExportVaultAction.FilePasswordInputChange(it))
            },
            onPasswordInputChanged = {
                viewModel.trySendAction(ExportVaultAction.PasswordInputChanged(it))
            },
            onSendCodeClicked = { viewModel.trySendAction(ExportVaultAction.SendCodeClick) },
            onExportVaultClick = { shouldShowConfirmationDialog = true },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
@Suppress("LongMethod")
private fun ExportVaultScreenContent(
    state: ExportVaultState,
    onConfirmFilePasswordInputChanged: (String) -> Unit,
    onExportFormatOptionSelected: (ExportVaultFormat) -> Unit,
    onFilePasswordInputChanged: (String) -> Unit,
    onPasswordInputChanged: (String) -> Unit,
    onSendCodeClicked: () -> Unit,
    onExportVaultClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        if (state.policyPreventsExport) {
            VowkeyInfoCalloutCard(
                text = stringResource(
                    id = VowkeyString.disable_personal_vault_export_policy_in_effect,
                ),
                modifier = Modifier
                    .testTag("DisablePrivateVaultPolicyLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))
        }

        val resources = LocalResources.current
        VowkeyMultiSelectButton(
            label = stringResource(id = VowkeyString.file_format),
            options = ExportVaultFormat.entries.map { it.displayLabel() }.toImmutableList(),
            selectedOption = state.exportFormat.displayLabel(),
            onOptionSelected = { selectedOptionLabel ->
                val selectedOption = ExportVaultFormat
                    .entries
                    .first { it.displayLabel(resources) == selectedOptionLabel }
                onExportFormatOptionSelected(selectedOption)
            },
            isEnabled = !state.policyPreventsExport,
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .testTag("FileFormatPicker")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        if (state.exportFormat == ExportVaultFormat.JSON_ENCRYPTED) {
            Spacer(modifier = Modifier.height(8.dp))
            var showPassword by rememberSaveable { mutableStateOf(false) }
            VowkeyPasswordField(
                label = stringResource(id = VowkeyString.file_password),
                value = state.filePasswordInput,
                onValueChange = onFilePasswordInputChanged,
                showPassword = showPassword,
                showPasswordChange = { showPassword = it },
                supportingContent = {
                    PasswordStrengthIndicator(
                        state = state.passwordStrengthState,
                        currentCharacterCount = state.passwordInput.length,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Text(
                        text = stringResource(id = VowkeyString.password_used_to_export),
                        style = VowkeyTheme.typography.bodySmall,
                        color = VowkeyTheme.colorScheme.text.secondary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                },
                showPasswordTestTag = "FilePasswordEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(8.dp))

            VowkeyPasswordField(
                label = stringResource(id = VowkeyString.confirm_file_password),
                value = state.confirmFilePasswordInput,
                onValueChange = onConfirmFilePasswordInputChanged,
                showPassword = showPassword,
                showPasswordChange = { showPassword = it },
                passwordFieldTestTag = "ConfirmFilePasswordEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
        }

        if (state.showSendCodeButton) {
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = stringResource(id = VowkeyString.send_verification_code_to_email),
                textAlign = TextAlign.Start,
                style = VowkeyTheme.typography.bodyMedium,
                color = VowkeyTheme.colorScheme.text.primary,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(8.dp))

            VowkeyOutlinedButton(
                label = stringResource(VowkeyString.send_code),
                onClick = onSendCodeClicked,
                isEnabled = !state.policyPreventsExport,
                modifier = Modifier
                    .testTag("SendTOTPCodeButton")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))

            VowkeyPasswordField(
                label = stringResource(id = VowkeyString.verification_code),
                value = state.passwordInput,
                readOnly = state.policyPreventsExport,
                supportingText = stringResource(id = VowkeyString.confirm_your_identity),
                onValueChange = onPasswordInputChanged,
                keyboardType = KeyboardType.Number,
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
        } else {
            Spacer(modifier = Modifier.height(height = 8.dp))
            VowkeyPasswordField(
                label = stringResource(id = VowkeyString.master_password),
                supportingText = stringResource(
                    id = VowkeyString.export_vault_master_password_description,
                ),
                value = state.passwordInput,
                readOnly = state.policyPreventsExport,
                onValueChange = onPasswordInputChanged,
                passwordFieldTestTag = "MasterPasswordEntry",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
        }

        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyOutlinedButton(
            label = stringResource(id = VowkeyString.export_vault),
            onClick = onExportVaultClick,
            isEnabled = !state.policyPreventsExport,
            modifier = Modifier
                .testTag("ExportVaultButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
    }
}
