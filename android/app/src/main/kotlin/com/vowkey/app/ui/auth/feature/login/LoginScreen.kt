package com.vowkey.app.ui.auth.feature.login

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.SoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.account.VowkeyAccountSwitcher
import com.vowkey.ui.platform.components.account.VowkeyPlaceholderAccountActionItem
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
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.auth.feature.landing.SocialSignInSection
import com.vowkey.app.ui.auth.feature.landing.VowkeyBrandHeader
import com.vowkey.app.ui.platform.composition.LocalAuthTabLaunchers
import com.vowkey.app.ui.platform.model.AuthTabLaunchers
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.app.R
import kotlinx.collections.immutable.persistentListOf

/**
 * The top level composable for the Login screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod")
fun LoginScreen(
    onNavigateBack: () -> Unit,
    onNavigateToMasterPasswordHint: (String) -> Unit,
    onNavigateToEnterpriseSignOn: (String) -> Unit,
    onNavigateToLoginWithDevice: (emailAddress: String) -> Unit,
    onNavigateToTwoFactorLogin: (String, String?, Boolean) -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
    keyboardController: SoftwareKeyboardController? = LocalSoftwareKeyboardController.current,
    authTabLaunchers: AuthTabLaunchers = LocalAuthTabLaunchers.current,
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            LoginEvent.NavigateBack -> onNavigateBack()
            is LoginEvent.NavigateToMasterPasswordHint -> {
                onNavigateToMasterPasswordHint(event.emailAddress)
            }

            is LoginEvent.NavigateToEnterpriseSignOn -> {
                onNavigateToEnterpriseSignOn(event.emailAddress)
            }

            is LoginEvent.NavigateToLoginWithDevice -> {
                onNavigateToLoginWithDevice(event.emailAddress)
            }

            is LoginEvent.NavigateToTwoFactorLogin -> {
                onNavigateToTwoFactorLogin(
                    event.emailAddress,
                    event.password,
                    event.isNewDeviceVerification,
                )
            }
            is LoginEvent.NavigateToSocialSignIn -> intentManager.startAuthTab(
                uri = event.uri,
                authTabData = event.authTabData,
                launcher = authTabLaunchers.sso,
            )
        }
    }

    LoginDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(LoginAction.ErrorDialogDismiss) },
    )

    val isAccountButtonVisible = state.accountSummaries.isNotEmpty()
    var isAccountMenuVisible by rememberSaveable { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = "Vowkey",
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(LoginAction.CloseButtonClick) },
                actions = {
                    if (isAccountButtonVisible) {
                        VowkeyPlaceholderAccountActionItem(
                            onClick = { isAccountMenuVisible = !isAccountMenuVisible },
                        )
                    }
                    VowkeyOverflowActionItem(
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.get_password_hint),
                                onClick = {
                                    viewModel.trySendAction(LoginAction.MasterPasswordHintClick)
                                },
                            ),
                        ),
                    )
                },
            )
        },
        overlay = {
            VowkeyAccountSwitcher(
                isVisible = isAccountMenuVisible,
                accountSummaries = state.accountSummaries,
                onSwitchAccountClick = {
                    viewModel.trySendAction(LoginAction.SwitchAccountClick(it))
                },
                onLockAccountClick = { viewModel.trySendAction(LoginAction.LockAccountClick(it)) },
                onLogoutAccountClick = {
                    viewModel.trySendAction(LoginAction.LogoutAccountClick(it))
                },
                onAddAccountClick = { viewModel.trySendAction(LoginAction.AddAccountClick) },
                onDismissRequest = { isAccountMenuVisible = false },
                topAppBarScrollBehavior = scrollBehavior,
                modifier = Modifier.fillMaxSize(),
            )
        },
    ) {
        LoginScreenContent(
            state = state,
            onPasswordInputChanged = {
                viewModel.trySendAction(LoginAction.PasswordInputChanged(it))
            },
            onMasterPasswordClick = {
                viewModel.trySendAction(LoginAction.MasterPasswordHintClick)
            },
            onLoginButtonClick = {
                keyboardController?.hide()
                viewModel.trySendAction(LoginAction.LoginButtonClick)
            },
            onLoginWithDeviceClick = {
                viewModel.trySendAction(LoginAction.LoginWithDeviceButtonClick)
            },
            onSingleSignOnClick = { viewModel.trySendAction(LoginAction.SingleSignOnClick) },
            onSocialSignInClick = {
                viewModel.trySendAction(LoginAction.SocialSignInClick(it))
            },
            onAppleClick = { viewModel.trySendAction(LoginAction.AppleClick) },
            onNotYouButtonClick = { viewModel.trySendAction(LoginAction.NotYouButtonClick) },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun LoginDialogs(
    dialogState: LoginState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is LoginState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            throwable = dialogState.error,
            onDismissRequest = onDismissRequest,
        )

        is LoginState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        null -> Unit
    }
}

@Suppress("LongMethod")
@Composable
private fun LoginScreenContent(
    state: LoginState,
    onPasswordInputChanged: (String) -> Unit,
    onMasterPasswordClick: () -> Unit,
    onLoginButtonClick: () -> Unit,
    onLoginWithDeviceClick: () -> Unit,
    onSingleSignOnClick: () -> Unit,
    onSocialSignInClick: (String) -> Unit,
    onAppleClick: () -> Unit,
    onNotYouButtonClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyBrandHeader(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(height = 20.dp))
        VowkeyPasswordField(
            autoFocus = true,
            value = state.passwordInput,
            onValueChange = onPasswordInputChanged,
            label = stringResource(id = VowkeyString.master_password),
            showPasswordTestTag = "PasswordVisibilityToggle",
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                VowkeyClickableText(
                    label = stringResource(id = VowkeyString.get_master_passwordword_hint),
                    onClick = onMasterPasswordClick,
                    style = VowkeyTheme.typography.labelMedium,
                    innerPadding = PaddingValues(all = 16.dp),
                    shape = VowkeyTheme.shapes.contentBottom,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = "GetMasterPasswordHintLabel"),
                )
            },
            passwordFieldTestTag = "MasterPasswordEntry",
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.log_in_with_master_password),
            onClick = onLoginButtonClick,
            isEnabled = state.isLoginButtonEnabled,
            modifier = Modifier
                .testTag("LogInWithMasterPasswordButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(12.dp))

        if (state.shouldShowLoginWithDevice) {
            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.log_in_with_device),
                icon = rememberVectorPainter(id = VowkeyDrawable.ic_mobile_small),
                onClick = onLoginWithDeviceClick,
                modifier = Modifier
                    .testTag("LogInWithAnotherDeviceButton")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))
        }

        if (state.isSocialLoginEnabled) {
            SocialSignInSection(
                showOrDivider = false,
                onSelectProvider = onSocialSignInClick,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(12.dp))
        }

        Spacer(modifier = Modifier.height(12.dp))

        Text(
            text = stringResource(
                id = VowkeyString.logging_in_as_x_on_y,
                state.emailAddress,
                state.environmentLabel,
            ),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.bodySmall,
            color = VowkeyTheme.colorScheme.text.secondary,
            modifier = Modifier
                .testTag("LoggingInAsLabel")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        VowkeyClickableText(
            label = stringResource(id = VowkeyString.not_you),
            onClick = onNotYouButtonClick,
            style = VowkeyTheme.typography.labelMedium,
            innerPadding = PaddingValues(vertical = 8.dp, horizontal = 16.dp),
            modifier = Modifier
                .standardHorizontalMargin()
                .align(alignment = Alignment.CenterHorizontally)
                .testTag("NotYouLabel"),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}
