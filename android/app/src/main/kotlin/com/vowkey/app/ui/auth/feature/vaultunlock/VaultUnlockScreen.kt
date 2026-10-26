package com.vowkey.app.ui.auth.feature.vaultunlock

import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusManager
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.account.VowkeyAccountActionItem
import com.vowkey.ui.platform.components.account.VowkeyAccountSwitcher
import com.vowkey.ui.platform.components.account.dialog.VowkeyLogoutConfirmationDialog
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.support.VowkeySupportingContent
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.auth.feature.vaultunlock.util.inputFieldVisibilityToggleTestTag
import com.vowkey.app.ui.auth.feature.vaultunlock.util.unlockScreenInputLabel
import com.vowkey.app.ui.auth.feature.vaultunlock.util.unlockScreenInputTestTag
import com.vowkey.app.ui.auth.feature.vaultunlock.util.unlockScreenKeyboardType
import com.vowkey.app.ui.auth.feature.vaultunlock.util.unlockScreenMessage
import com.vowkey.app.ui.auth.feature.vaultunlock.util.unlockScreenTitle
import com.vowkey.app.ui.credentials.manager.CredentialProviderCompletionManager
import com.vowkey.app.ui.credentials.manager.model.AssertFido2CredentialResult
import com.vowkey.app.ui.credentials.manager.model.GetCredentialsResult
import com.vowkey.app.ui.platform.composition.LocalBiometricsManager
import com.vowkey.app.ui.platform.composition.LocalCredentialProviderCompletionManager
import com.vowkey.app.ui.platform.manager.biometrics.BiometricsManager
import kotlinx.collections.immutable.persistentListOf
import kotlinx.coroutines.delay
import javax.crypto.Cipher
import kotlin.time.Duration.Companion.milliseconds

/**
 * Time slice to delay auto-focusing on the password/pin field. Because of the refresh that
 * takes place when switching accounts or changing the lock status we want to delay this
 * longer than the delay in place for sending those actions in [com.vowkey.app.MainViewModel]
 * defined by `ANIMATION_REFRESH_DELAY`. We need to  ensure this value is
 * always greater.
 */
private const val AUTO_FOCUS_DELAY = 575L

/**
 * The top level composable for the Vault Unlock screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod", "CyclomaticComplexMethod")
@Composable
fun VaultUnlockScreen(
    viewModel: VaultUnlockViewModel = hiltViewModel(),
    biometricsManager: BiometricsManager = LocalBiometricsManager.current,
    focusManager: FocusManager = LocalFocusManager.current,
    credentialProviderCompletionManager: CredentialProviderCompletionManager =
        LocalCredentialProviderCompletionManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    LaunchedEffect(state.requiresBiometricsLogin) {
        if (state.requiresBiometricsLogin && !biometricsManager.isBiometricsSupported) {
            viewModel.trySendAction(VaultUnlockAction.BiometricsNoLongerSupported)
        }
    }

    val onBiometricsUnlockSuccess: (cipher: Cipher) -> Unit = {
        viewModel.trySendAction(VaultUnlockAction.BiometricsUnlockSuccess(it))
    }
    val onBiometricsLockOut: () -> Unit = {
        viewModel.trySendAction(VaultUnlockAction.BiometricsLockOut)
    }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is VaultUnlockEvent.PromptForBiometrics -> {
                biometricsManager.promptBiometrics(
                    onSuccess = onBiometricsUnlockSuccess,
                    onCancel = {
                        // no-op
                    },
                    onError = {
                        // no-op
                    },
                    onLockOut = onBiometricsLockOut,
                    cipher = event.cipher,
                )
            }

            is VaultUnlockEvent.Fido2CredentialAssertionError -> {
                credentialProviderCompletionManager.completeFido2Assertion(
                    result = AssertFido2CredentialResult.Error(message = event.message),
                )
            }

            is VaultUnlockEvent.GetCredentialsError -> {
                credentialProviderCompletionManager.completeProviderGetCredentialsRequest(
                    result = GetCredentialsResult.Error(message = event.message),
                )
            }
        }
    }

    var accountMenuVisible by rememberSaveable { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(
        state = rememberTopAppBarState(),
        canScroll = { !accountMenuVisible },
    )

    // Dynamic dialogs
    when (val dialog = state.dialog) {
        is VaultUnlockState.VaultUnlockDialog.Error -> VowkeyBasicDialog(
            title = dialog.title(),
            message = dialog.message(),
            onDismissRequest = { viewModel.trySendAction(VaultUnlockAction.DismissDialog) },
            throwable = dialog.throwable,
        )

        VaultUnlockState.VaultUnlockDialog.Loading -> VowkeyLoadingDialog(
            text = stringResource(id = VowkeyString.loading),
        )

        VaultUnlockState.VaultUnlockDialog.BiometricsNoLongerSupported -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.biometrics_no_longer_supported_title),
                message = stringResource(id = VowkeyString.biometrics_no_longer_supported),
                onDismissRequest = remember {
                    {
                        viewModel.trySendAction(
                            VaultUnlockAction.DismissBiometricsNoLongerSupportedDialog,
                        )
                    }
                },
            )
        }

        null -> Unit
    }

    // Static dialogs
    var showLogoutConfirmationDialog by remember { mutableStateOf(false) }
    if (showLogoutConfirmationDialog) {
        VowkeyLogoutConfirmationDialog(
            onDismissRequest = { showLogoutConfirmationDialog = false },
            onConfirmClick = {
                showLogoutConfirmationDialog = false
                viewModel.trySendAction(VaultUnlockAction.ConfirmLogoutClick)
            },
        )
    }

    // Content
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection)
            .pointerInput(Unit) {
                detectTapGestures(
                    onTap = { focusManager.clearFocus(force = true) },
                )
            },
        topBar = {
            VowkeyTopAppBar(
                title = state.vaultUnlockType.unlockScreenTitle(),
                scrollBehavior = scrollBehavior,
                navigationIcon = null,
                actions = {
                    if (state.showAccountMenu) {
                        VowkeyAccountActionItem(
                            initials = state.initials,
                            color = state.avatarColor,
                            onClick = {
                                focusManager.clearFocus()
                                accountMenuVisible = !accountMenuVisible
                            },
                        )
                    }
                    VowkeyOverflowActionItem(
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.log_out),
                                onClick = { showLogoutConfirmationDialog = true },
                            ),
                        ),
                    )
                },
            )
        },
        overlay = {
            VowkeyAccountSwitcher(
                isVisible = accountMenuVisible,
                accountSummaries = state.accountSummaries,
                onSwitchAccountClick = {
                    viewModel.trySendAction(VaultUnlockAction.SwitchAccountClick(it))
                },
                onLockAccountClick = {
                    viewModel.trySendAction(VaultUnlockAction.LockAccountClick(it))
                },
                onLogoutAccountClick = {
                    viewModel.trySendAction(VaultUnlockAction.LogoutAccountClick(it))
                },
                onAddAccountClick = { viewModel.trySendAction(VaultUnlockAction.AddAccountClick) },
                onDismissRequest = { accountMenuVisible = false },
                topAppBarScrollBehavior = scrollBehavior,
                modifier = Modifier.fillMaxSize(),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(12.dp))
            if (!state.hideInput) {
                // When switching from an unlocked account to a locked account, the
                // current activity is recreated and therefore the composition takes place
                // twice. Adding this delay prevents the MP or Pin field
                // from auto focusing on the first composition which creates a visual jank where
                // the keyboard shows, disappears, and then shows again.
                var autoFocusDelayCompleted by rememberSaveable {
                    mutableStateOf(false)
                }
                LaunchedEffect(Unit) {
                    delay(AUTO_FOCUS_DELAY.milliseconds)
                    autoFocusDelayCompleted = true
                }
                VowkeyPasswordField(
                    label = state.vaultUnlockType.unlockScreenInputLabel(),
                    value = state.input,
                    onValueChange = { viewModel.trySendAction(VaultUnlockAction.InputChanged(it)) },
                    keyboardType = state.vaultUnlockType.unlockScreenKeyboardType,
                    showPasswordTestTag = state
                        .vaultUnlockType
                        .inputFieldVisibilityToggleTestTag,
                    autoFocus = state.showKeyboard && autoFocusDelayCompleted,
                    imeAction = ImeAction.Done,
                    keyboardActions = KeyboardActions(
                        onDone = { viewModel.trySendAction(VaultUnlockAction.UnlockClick) },
                    ),
                    passwordFieldTestTag = state.vaultUnlockType.unlockScreenInputTestTag,
                    cardStyle = CardStyle.Top(),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            VowkeySupportingContent(
                cardStyle = if (state.hideInput) CardStyle.Full else CardStyle.Bottom,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            ) {
                if (!state.hideInput) {
                    Text(
                        text = state.vaultUnlockType.unlockScreenMessage(),
                        style = VowkeyTheme.typography.bodySmall,
                        color = VowkeyTheme.colorScheme.text.secondary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.height(height = 16.dp))
                }
                Text(
                    text = stringResource(
                        id = VowkeyString.logged_in_as_on,
                        formatArgs = arrayOf(state.email, state.environmentUrl),
                    ),
                    style = VowkeyTheme.typography.bodySmall,
                    color = VowkeyTheme.colorScheme.text.secondary,
                    modifier = Modifier
                        .testTag(tag = "UserAndEnvironmentDataLabel")
                        .fillMaxWidth(),
                )
            }
            Spacer(modifier = Modifier.height(24.dp))
            if (state.showBiometricLogin && biometricsManager.isBiometricsSupported) {
                VowkeyOutlinedButton(
                    label = stringResource(id = VowkeyString.use_biometrics_to_unlock),
                    onClick = { viewModel.trySendAction(VaultUnlockAction.BiometricsUnlockClick) },
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(12.dp))
            } else if (state.showBiometricInvalidatedMessage) {
                Text(
                    text = stringResource(VowkeyString.account_biometric_invalidated),
                    textAlign = TextAlign.Start,
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.status.error,
                    modifier = Modifier.standardHorizontalMargin(),
                )
                Spacer(modifier = Modifier.height(12.dp))
            }
            if (!state.hideInput) {
                VowkeyFilledButton(
                    label = stringResource(id = VowkeyString.unlock),
                    onClick = { viewModel.trySendAction(VaultUnlockAction.UnlockClick) },
                    isEnabled = state.input.isNotEmpty(),
                    modifier = Modifier
                        .testTag("UnlockVaultButton")
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
