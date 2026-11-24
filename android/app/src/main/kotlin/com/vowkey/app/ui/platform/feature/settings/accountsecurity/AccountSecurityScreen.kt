package com.vowkey.app.ui.platform.feature.settings.accountsecurity

import android.content.res.Resources
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.account.dialog.VowkeyLogoutConfirmationDialog
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.badge.NotificationBadge
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.card.actionCardExitAnimation
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.dropdown.VowkeyTimePickerButton
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.row.VowkeyExternalLinkRow
import com.vowkey.ui.platform.components.row.VowkeyTextRow
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.support.VowkeySupportingText
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.util.startAppSettingsActivity
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.model.PolicyInformation
import com.vowkey.app.data.platform.repository.model.VaultTimeout
import com.vowkey.app.data.platform.repository.model.VaultTimeoutAction
import com.vowkey.app.ui.platform.components.toggle.VowkeyUnlockWithBiometricsSwitch
import com.vowkey.app.ui.platform.components.toggle.VowkeyUnlockWithPinSwitch
import com.vowkey.app.ui.platform.composition.LocalBiometricsManager
import com.vowkey.app.ui.platform.manager.biometrics.BiometricSupportStatus
import com.vowkey.app.ui.platform.manager.biometrics.BiometricsManager
import com.vowkey.app.ui.platform.util.displayLabel
import com.vowkey.app.ui.platform.util.minutes
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.toImmutableList
import javax.crypto.Cipher

/**
 * Displays the account security screen.
 */
@Suppress("LongMethod", "LongParameterList", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountSecurityScreen(
    onNavigateBack: () -> Unit,
    onNavigateToDeleteAccount: () -> Unit,
    onNavigateToPendingRequests: () -> Unit,
    onNavigateToSetupUnlockScreen: () -> Unit,
    onNavigateToManageDevices: () -> Unit,
    viewModel: AccountSecurityViewModel = hiltViewModel(),
    biometricsManager: BiometricsManager = LocalBiometricsManager.current,
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    var showBiometricsPrompt by rememberSaveable { mutableStateOf(false) }
    val unlockWithBiometricToggle: (cipher: Cipher) -> Unit = {
        viewModel.trySendAction(AccountSecurityAction.UnlockWithBiometricToggleEnabled(it))
    }
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            AccountSecurityEvent.NavigateBack -> onNavigateBack()

            AccountSecurityEvent.NavigateToApplicationDataSettings -> {
                intentManager.startAppSettingsActivity()
            }

            AccountSecurityEvent.NavigateToDeleteAccount -> onNavigateToDeleteAccount()

            AccountSecurityEvent.NavigateToFingerprintPhrase -> {
                intentManager.launchUri("https://vowkey.app/#security".toUri())
            }

            AccountSecurityEvent.NavigateToPendingRequests -> onNavigateToPendingRequests()

            is AccountSecurityEvent.NavigateToTwoStepLogin -> {
                intentManager.launchUri(event.url.toUri())
            }

            is AccountSecurityEvent.NavigateToChangeMasterPassword -> {
                intentManager.launchUri(event.url.toUri())
            }

            is AccountSecurityEvent.NavigateToManageDevices -> onNavigateToManageDevices()

            is AccountSecurityEvent.ShowBiometricsPrompt -> {
                showBiometricsPrompt = true
                biometricsManager.promptBiometrics(
                    onSuccess = {
                        unlockWithBiometricToggle(it)
                        showBiometricsPrompt = false
                    },
                    onCancel = { showBiometricsPrompt = false },
                    onLockOut = { showBiometricsPrompt = false },
                    onError = { showBiometricsPrompt = false },
                    cipher = event.cipher,
                )
            }

            AccountSecurityEvent.NavigateToSetupUnlockScreen -> onNavigateToSetupUnlockScreen()
            is AccountSecurityEvent.NavigateToPlan -> intentManager.launchUri(event.url.toUri())
        }
    }

    AccountSecurityDialogs(
        state = state,
        onDismissRequest = { viewModel.trySendAction(AccountSecurityAction.DismissDialog) },
        onConfirmLogoutClick = {
            viewModel.trySendAction(AccountSecurityAction.ConfirmLogoutClick)
        },
        onFingerprintLearnMore = {
            viewModel.trySendAction(AccountSecurityAction.FingerPrintLearnMoreClick)
        },
    )
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.account_security),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = {
                    viewModel.trySendAction(AccountSecurityAction.BackClick)
                },
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            AnimatedVisibility(
                visible = state.shouldShowUnlockActionCard,
                label = "UnlockActionCard",
                exit = actionCardExitAnimation(),
            ) {
                VowkeyActionCard(
                    cardTitle = stringResource(id = VowkeyString.set_up_unlock),
                    actionButton = VowkeyButtonData(
                        label = VowkeyString.get_started.asText(),
                        onClick = {
                            viewModel.trySendAction(AccountSecurityAction.UnlockActionCardCtaClick)
                        },
                    ),
                    onDismissClick = {
                        viewModel.trySendAction(AccountSecurityAction.UnlockActionCardDismiss)
                    },
                    leadingContent = {
                        NotificationBadge(notificationCount = 1)
                    },
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .padding(bottom = 16.dp),
                )
            }

            if (!state.isManageDevicesEnabled) {
                VowkeyListHeaderText(
                    label = stringResource(id = VowkeyString.approve_login_requests),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .padding(horizontal = 16.dp),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
                VowkeyTextRow(
                    text = stringResource(id = VowkeyString.pending_log_in_requests),
                    onClick = {
                        viewModel.trySendAction(AccountSecurityAction.PendingLoginRequestsClick)
                    },
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .testTag("PendingLogInRequestsLabel")
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }

            val biometricSupportStatus = biometricsManager.biometricSupportStatus
            if (biometricSupportStatus != BiometricSupportStatus.NOT_SUPPORTED ||
                !state.removeUnlockWithPinPolicyEnabled ||
                state.isUnlockWithPinEnabled
            ) {
                if (!state.isManageDevicesEnabled) {
                    Spacer(Modifier.height(16.dp))
                }
                VowkeyListHeaderText(
                    label = stringResource(id = VowkeyString.unlock_options),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .padding(horizontal = 16.dp),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
            }
            VowkeyUnlockWithBiometricsSwitch(
                biometricSupportStatus = biometricSupportStatus,
                isChecked = state.isUnlockWithBiometricsEnabled || showBiometricsPrompt,
                onDisableBiometrics = {
                    viewModel.trySendAction(AccountSecurityAction.UnlockWithBiometricToggleDisabled)
                },
                onEnableBiometrics = {
                    viewModel.trySendAction(AccountSecurityAction.EnableBiometricsClick)
                },
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .testTag("UnlockWithBiometricsSwitch")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
            if (!state.removeUnlockWithPinPolicyEnabled || state.isUnlockWithPinEnabled) {
                Spacer(modifier = Modifier.height(height = 8.dp))
                VowkeyUnlockWithPinSwitch(
                    isUnlockWithPasswordEnabled = state.isUnlockWithPasswordEnabled,
                    isUnlockWithPinEnabled = state.isUnlockWithPinEnabled,
                    onUnlockWithPinToggleAction = {
                        viewModel.trySendAction(AccountSecurityAction.UnlockWithPinToggle(it))
                    },
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .testTag("UnlockWithPinSwitch")
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }
            Spacer(Modifier.height(16.dp))
            if (state.shouldShowEnableAuthenticatorSync) {
                SyncWithAuthenticatorRow(
                    isChecked = state.isAuthenticatorSyncChecked,
                    onCheckedChange = {
                        viewModel.trySendAction(AccountSecurityAction.AuthenticatorSyncToggle(it))
                    },
                )
                Spacer(Modifier.height(16.dp))
            }
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.session_timeout),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
            SessionTimeoutRow(
                vaultTimeoutPolicy = state.vaultTimeoutPolicy,
                selectedVaultTimeoutType = state.vaultTimeout.type,
                onVaultTimeoutTypeSelect = {
                    viewModel.trySendAction(AccountSecurityAction.VaultTimeoutTypeSelect(it))
                },
                modifier = Modifier
                    .testTag("VaultTimeoutChooser")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
            (state.vaultTimeout as? VaultTimeout.Custom)?.let { customTimeout ->
                SessionCustomTimeoutRow(
                    vaultTimeoutPolicy = state.vaultTimeoutPolicy,
                    customVaultTimeout = customTimeout,
                    onCustomVaultTimeoutSelect = {
                        viewModel.trySendAction(AccountSecurityAction.CustomVaultTimeoutSelect(it))
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }
            state.sessionTimeoutSupportText?.let { text ->
                VowkeySupportingText(
                    text = text(),
                    cardStyle = CardStyle.Bottom,
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
            }
            SessionTimeoutActionRow(
                isEnabled = state.isSessionTimeoutActionEnabled,
                selectedVaultTimeoutAction = state.vaultTimeoutAction,
                onVaultTimeoutActionSelect = {
                    viewModel.trySendAction(AccountSecurityAction.VaultTimeoutActionSelect(it))
                },
                supportingText = state.sessionTimeoutActionSupportingText?.invoke(),
                cardStyle = if (state.sessionTimeoutSupportText == null) {
                    CardStyle.Bottom
                } else {
                    CardStyle.Full
                },
                modifier = Modifier
                    .testTag("VaultTimeoutActionChooser")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(Modifier.height(16.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.other),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
            state.planName?.let { planName ->
                VowkeyTextRow(
                    text = stringResource(id = VowkeyString.plan),
                    description = AnnotatedString(planName()),
                    isExternalLink = true,
                    onClick = { viewModel.trySendAction(AccountSecurityAction.PlanClick) },
                    cardStyle = CardStyle.Top(),
                    modifier = Modifier
                        .testTag("PlanLabel")
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            VowkeyTextRow(
                text = stringResource(id = VowkeyString.account_fingerprint_phrase),
                onClick = {
                    viewModel.trySendAction(AccountSecurityAction.AccountFingerprintPhraseClick)
                },
                cardStyle = if (state.planName == null) CardStyle.Top() else CardStyle.Middle(),
                modifier = Modifier
                    .testTag("AccountFingerprintPhraseLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            VowkeyExternalLinkRow(
                text = stringResource(id = VowkeyString.two_step_login),
                onConfirmClick = {
                    viewModel.trySendAction(AccountSecurityAction.TwoStepLoginClick)
                },
                withDivider = false,
                dialogTitle = stringResource(id = VowkeyString.continue_to_web_app),
                dialogMessage = stringResource(
                    id = VowkeyString.two_step_login_description_long,
                ),
                cardStyle = CardStyle.Middle(),
                modifier = Modifier
                    .testTag("TwoStepLoginLinkItemView")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            if (state.isManageDevicesEnabled) {
                VowkeyTextRow(
                    text = stringResource(id = VowkeyString.devices),
                    onClick = {
                        viewModel.trySendAction(AccountSecurityAction.ManageDevicesClick)
                    },
                    cardStyle = CardStyle.Middle(),
                    modifier = Modifier
                        .testTag("ManageDevicesLabel")
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            if (state.isUnlockWithPasswordEnabled) {
                VowkeyExternalLinkRow(
                    text = stringResource(id = VowkeyString.change_master_password),
                    onConfirmClick = {
                        viewModel.trySendAction(AccountSecurityAction.ChangeMasterPasswordClick)
                    },
                    withDivider = false,
                    dialogTitle = stringResource(id = VowkeyString.continue_to_web_app),
                    dialogMessage = stringResource(
                        id = VowkeyString.change_master_password_description_long,
                    ),
                    cardStyle = CardStyle.Middle(),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            if (state.hasUnlockMechanism) {
                VowkeyTextRow(
                    text = stringResource(id = VowkeyString.lock_now),
                    onClick = { viewModel.trySendAction(AccountSecurityAction.LockNowClick) },
                    cardStyle = CardStyle.Middle(),
                    modifier = Modifier
                        .testTag("LockNowLabel")
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            VowkeyTextRow(
                text = stringResource(id = VowkeyString.log_out),
                onClick = { viewModel.trySendAction(AccountSecurityAction.LogoutClick) },
                cardStyle = CardStyle.Middle(),
                modifier = Modifier
                    .testTag("LogOutLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            VowkeyTextRow(
                text = stringResource(id = VowkeyString.delete_account),
                onClick = { viewModel.trySendAction(AccountSecurityAction.DeleteAccountClick) },
                cardStyle = CardStyle.Bottom,
                modifier = Modifier
                    .testTag("DeleteAccountLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun AccountSecurityDialogs(
    state: AccountSecurityState,
    onDismissRequest: () -> Unit,
    onConfirmLogoutClick: () -> Unit,
    onFingerprintLearnMore: () -> Unit,
) {
    when (val dialogState = state.dialog) {
        AccountSecurityDialog.ConfirmLogout -> VowkeyLogoutConfirmationDialog(
            onDismissRequest = onDismissRequest,
            onConfirmClick = onConfirmLogoutClick,
        )

        AccountSecurityDialog.FingerprintPhrase -> FingerPrintPhraseDialog(
            fingerprintPhrase = state.fingerprintPhrase,
            onDismissRequest = onDismissRequest,
            onLearnMore = onFingerprintLearnMore,
        )

        is AccountSecurityDialog.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        is AccountSecurityDialog.Error -> VowkeyBasicDialog(
            title = dialogState.title(),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
        )

        null -> Unit
    }
}

@Composable
private fun SessionTimeoutRow(
    vaultTimeoutPolicy: VaultTimeoutPolicy?,
    selectedVaultTimeoutType: VaultTimeout.Type,
    onVaultTimeoutTypeSelect: (VaultTimeout.Type) -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    var shouldShowNeverTimeoutConfirmationDialog by remember { mutableStateOf(false) }
    val vaultTimeoutOptions = rememberSessionTimeoutOptions(vaultTimeoutPolicy)
    VowkeyMultiSelectButton(
        label = stringResource(id = VowkeyString.session_timeout),
        options = vaultTimeoutOptions.map { it.displayLabel() }.toImmutableList(),
        selectedOption = selectedVaultTimeoutType.displayLabel(),
        onOptionSelected = { selectedType ->
            val selectedOption = vaultTimeoutOptions.first {
                it.displayLabel.toString(resources) == selectedType
            }
            if (selectedOption == VaultTimeout.Type.NEVER) {
                shouldShowNeverTimeoutConfirmationDialog = true
            } else {
                onVaultTimeoutTypeSelect(selectedOption)
            }
        },
        isEnabled = vaultTimeoutOptions.size > 1,
        textFieldTestTag = "SessionTimeoutStatusLabel",
        cardStyle = CardStyle.Top(),
        modifier = modifier,
    )

    if (shouldShowNeverTimeoutConfirmationDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.warning),
            message = stringResource(id = VowkeyString.never_lock_warning),
            confirmButtonText = stringResource(id = VowkeyString.okay),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowNeverTimeoutConfirmationDialog = false
                onVaultTimeoutTypeSelect(VaultTimeout.Type.NEVER)
            },
            onDismissClick = { shouldShowNeverTimeoutConfirmationDialog = false },
            onDismissRequest = { shouldShowNeverTimeoutConfirmationDialog = false },
        )
    }
}

@Composable
private fun SessionCustomTimeoutRow(
    vaultTimeoutPolicy: VaultTimeoutPolicy?,
    customVaultTimeout: VaultTimeout.Custom,
    onCustomVaultTimeoutSelect: (VaultTimeout.Custom) -> Unit,
    modifier: Modifier = Modifier,
) {
    var shouldShowViolatesPoliciesDialog by remember { mutableStateOf(false) }
    VowkeyTimePickerButton(
        label = stringResource(id = VowkeyString.custom_timeout),
        totalMinutes = customVaultTimeout.vaultTimeoutInMinutes,
        onTimeSelect = { minutes ->
            if (vaultTimeoutPolicy?.minutes != null && minutes > vaultTimeoutPolicy.minutes) {
                shouldShowViolatesPoliciesDialog = true
            } else {
                onCustomVaultTimeoutSelect(VaultTimeout.Custom(minutes))
            }
        },
        is24Hour = true,
        supportingContent = null,
        cardStyle = CardStyle.Middle(),
        modifier = modifier,
    )

    if (shouldShowViolatesPoliciesDialog) {
        VowkeyBasicDialog(
            title = stringResource(id = VowkeyString.warning),
            message = stringResource(id = VowkeyString.vault_timeout_to_large),
            onDismissRequest = {
                shouldShowViolatesPoliciesDialog = false
                vaultTimeoutPolicy?.minutes?.let {
                    onCustomVaultTimeoutSelect(VaultTimeout.Custom(it))
                }
            },
        )
    }
}

@Composable
private fun SessionTimeoutActionRow(
    isEnabled: Boolean,
    selectedVaultTimeoutAction: VaultTimeoutAction,
    onVaultTimeoutActionSelect: (VaultTimeoutAction) -> Unit,
    supportingText: String?,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    var shouldShowLogoutActionConfirmationDialog by rememberSaveable { mutableStateOf(false) }
    VowkeyMultiSelectButton(
        isEnabled = isEnabled,
        label = stringResource(id = VowkeyString.session_timeout_action),
        options = VaultTimeoutAction.entries.map { it.displayLabel() }.toImmutableList(),
        selectedOption = selectedVaultTimeoutAction.displayLabel(),
        onOptionSelected = { action ->
            val selectedAction = VaultTimeoutAction.entries.first {
                it.displayLabel.toString(resources) == action
            }
            if (selectedAction == VaultTimeoutAction.LOGOUT) {
                shouldShowLogoutActionConfirmationDialog = true
            } else {
                onVaultTimeoutActionSelect(selectedAction)
            }
        },
        supportingText = supportingText,
        textFieldTestTag = "SessionTimeoutActionStatusLabel",
        cardStyle = cardStyle,
        modifier = modifier,
    )

    if (shouldShowLogoutActionConfirmationDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.vault_timeout_log_out_confirmation_title),
            message = stringResource(
                id = VowkeyString.vault_timeout_log_out_confirmation_message,
            ),
            confirmButtonText = stringResource(id = VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowLogoutActionConfirmationDialog = false
                onVaultTimeoutActionSelect(VaultTimeoutAction.LOGOUT)
            },
            onDismissClick = {
                shouldShowLogoutActionConfirmationDialog = false
            },
            onDismissRequest = {
                shouldShowLogoutActionConfirmationDialog = false
            },
        )
    }
}

@Composable
private fun ColumnScope.SyncWithAuthenticatorRow(
    isChecked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
) {
    VowkeyListHeaderText(
        label = stringResource(VowkeyString.authenticator_sync),
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin()
            .padding(horizontal = 16.dp),
    )
    Spacer(modifier = Modifier.height(height = 8.dp))
    VowkeySwitch(
        label = stringResource(VowkeyString.allow_vowkey_authenticator_syncing),
        onCheckedChange = onCheckedChange,
        isChecked = isChecked,
        cardStyle = CardStyle.Full,
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )
}

@Composable
private fun FingerPrintPhraseDialog(
    fingerprintPhrase: Text,
    onDismissRequest: () -> Unit,
    onLearnMore: () -> Unit,
) {
    VowkeyTwoButtonDialog(
        title = stringResource(id = VowkeyString.fingerprint_phrase),
        message = buildAnnotatedString {
            append("${stringResource(id = VowkeyString.your_accounts_fingerprint)}:\n\n")
            withStyle(
                style = VowkeyTheme.typography.sensitiveInfoSmall
                    .toSpanStyle()
                    .copy(color = VowkeyTheme.colorScheme.text.codePink),
            ) {
                append(fingerprintPhrase())
            }
        },
        confirmButtonText = stringResource(id = VowkeyString.learn_more),
        dismissButtonText = stringResource(id = VowkeyString.close),
        onConfirmClick = onLearnMore,
        onDismissClick = onDismissRequest,
        onDismissRequest = onDismissRequest,
    )
}

@Composable
private fun rememberSessionTimeoutOptions(
    vaultTimeoutPolicy: VaultTimeoutPolicy?,
): ImmutableList<VaultTimeout.Type> = remember(vaultTimeoutPolicy) {
    VaultTimeout.Type
        .entries
        .filter { timeoutType ->
            when (vaultTimeoutPolicy?.type) {
                PolicyInformation.VaultTimeout.Type.NEVER -> {
                    // We allow everything here.
                    true
                }

                PolicyInformation.VaultTimeout.Type.ON_APP_RESTART,
                PolicyInformation.VaultTimeout.Type.ON_SYSTEM_LOCK,
                    -> {
                    // We allow everything but never here.
                    timeoutType != VaultTimeout.Type.NEVER
                }

                PolicyInformation.VaultTimeout.Type.IMMEDIATELY -> {
                    // Only allow immediately, everything else is blocked.
                    timeoutType == VaultTimeout.Type.IMMEDIATELY
                }

                PolicyInformation.VaultTimeout.Type.CUSTOM -> {
                    // Filter out all values above the specified amount. Custom set timeouts
                    // that exceed the max value will be constrained in the VM.
                    timeoutType.minutes <= (vaultTimeoutPolicy.minutes ?: Int.MAX_VALUE)
                }

                null -> {
                    // If the type is null, there could still be a policy in place from a
                    // legacy server that is not sending a type. So we still filter as though
                    // it were a custom type in that scenario, otherwise we allow everything.
                    vaultTimeoutPolicy
                        ?.minutes
                        ?.let { minutes -> timeoutType.minutes <= minutes }
                        ?: true
                }
            }
        }
        .toImmutableList()
}
