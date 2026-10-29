package com.vowkey.app.ui.auth.feature.landing

import com.vowkey.app.R

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.wrapContentHeight
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.account.VowkeyAccountSwitcher
import com.vowkey.ui.platform.components.account.VowkeyPlaceholderAccountActionItem
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.components.dropdown.EnvironmentSelector

/**
 * The top level composable for the Landing screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod")
fun LandingScreen(
    onNavigateToLogin: (emailAddress: String) -> Unit,
    onNavigateToEnvironment: () -> Unit,
    onNavigateToStartRegistration: () -> Unit,
    onNavigateToLocalVault: () -> Unit,
    onNavigateToPreAuthSettings: () -> Unit,
    viewModel: LandingViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is LandingEvent.NavigateToLogin -> onNavigateToLogin(event.emailAddress)
            LandingEvent.NavigateToEnvironment -> onNavigateToEnvironment()
            LandingEvent.NavigateToStartRegistration -> onNavigateToStartRegistration()
            LandingEvent.NavigateToLocalVault -> onNavigateToLocalVault()
            LandingEvent.NavigateToSettings -> onNavigateToPreAuthSettings()
            is LandingEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    when (val dialog = state.dialog) {
        is LandingState.DialogState.AccountAlreadyAdded -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.account_already_added),
                message = stringResource(
                    id = VowkeyString.switch_to_already_added_account_confirmation,
                ),
                confirmButtonText = stringResource(id = VowkeyString.yes),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = {
                    viewModel.trySendAction(
                        LandingAction.ConfirmSwitchToMatchingAccountClick(dialog.accountSummary),
                    )
                },
                onDismissClick = { viewModel.trySendAction(LandingAction.DialogDismiss) },
                onDismissRequest = { viewModel.trySendAction(LandingAction.DialogDismiss) },
            )
        }

        is LandingState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.an_error_has_occurred),
                message = dialog.message(),
                onDismissRequest = { viewModel.trySendAction(LandingAction.DialogDismiss) },
            )
        }

        null -> Unit
    }

    var isAccountMenuVisible by rememberSaveable { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(
        state = rememberTopAppBarState(),
        canScroll = { !isAccountMenuVisible },
    )

    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            if (state.isAppBarVisible) {
                VowkeyTopAppBar(
                    title = "",
                    scrollBehavior = scrollBehavior,
                    navigationIcon = null,
                    actions = {
                        VowkeyPlaceholderAccountActionItem(
                            onClick = { isAccountMenuVisible = !isAccountMenuVisible },
                        )
                    },
                )
            }
        },
        overlay = {
            VowkeyAccountSwitcher(
                isVisible = isAccountMenuVisible,
                accountSummaries = state.accountSummaries,
                onSwitchAccountClick = {
                    viewModel.trySendAction(LandingAction.SwitchAccountClick(it))
                },
                onLockAccountClick = {
                    viewModel.trySendAction(LandingAction.LockAccountClick(it))
                },
                onLogoutAccountClick = {
                    viewModel.trySendAction(LandingAction.LogoutAccountClick(it))
                },
                onAddAccountClick = {
                    // Not available
                },
                onDismissRequest = { isAccountMenuVisible = false },
                isAddAccountAvailable = false,
                topAppBarScrollBehavior = scrollBehavior,
                modifier = Modifier.fillMaxSize(),
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        LandingScreenContent(
            state = state,
            onEmailInputChange = { viewModel.trySendAction(LandingAction.EmailInputChanged(it)) },
            onEnvironmentTypeSelect = {
                viewModel.trySendAction(LandingAction.EnvironmentTypeSelect(it))
            },
            onRememberMeToggle = { viewModel.trySendAction(LandingAction.RememberMeToggle(it)) },
            onContinueClick = { viewModel.trySendAction(LandingAction.ContinueButtonClick) },
            onContinueWithoutAccountClick = {
                viewModel.trySendAction(LandingAction.ContinueWithoutAccountClick)
            },
            onCreateAccountClick = { viewModel.trySendAction(LandingAction.CreateAccountClick) },
            onAppSettingsClick = { viewModel.trySendAction(LandingAction.AppSettingsClick) },
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun LandingScreenContent(
    state: LandingState,
    onEmailInputChange: (String) -> Unit,
    onEnvironmentTypeSelect: (Environment.Type) -> Unit,
    onRememberMeToggle: (Boolean) -> Unit,
    onContinueClick: () -> Unit,
    onContinueWithoutAccountClick: () -> Unit,
    onCreateAccountClick: () -> Unit,
    onAppSettingsClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding(),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        Spacer(modifier = Modifier.weight(1f))

        Image(
            painter = rememberVectorPainter(id = VowkeyDrawable.logo_vowkey),
            contentDescription = null,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.weight(1f))
        Spacer(modifier = Modifier.height(height = 12.dp))

        Text(
            text = stringResource(id = VowkeyString.login_to_vowkey),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.headlineSmall,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .standardHorizontalMargin()
                .wrapContentHeight(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        VowkeyTextField(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
            value = state.emailInput,
            onValueChange = onEmailInputChange,
            label = stringResource(id = VowkeyString.email_address),
            keyboardType = KeyboardType.Email,
            textFieldTestTag = "EmailAddressEntry",
            cardStyle = CardStyle.Full,
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                EnvironmentSelector(
                    labelText = stringResource(id = VowkeyString.logging_in_on_with_colon),
                    dialogTitle = stringResource(id = VowkeyString.logging_in_on),
                    options = state.environmentTypeOptions,
                    selectedOption = state.selectedEnvironmentType,
                    onOptionSelected = onEnvironmentTypeSelect,
                    isHelpEnabled = false,
                    onHelpClick = {},
                    modifier = Modifier
                        .testTag("RegionSelectorDropdown")
                        .fillMaxWidth(),
                )
            },
        )

        Spacer(modifier = Modifier.height(height = 8.dp))

        VowkeySwitch(
            label = stringResource(id = VowkeyString.remember_email),
            isChecked = state.isRememberEmailEnabled,
            onCheckedChange = onRememberMeToggle,
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .testTag("RememberMeSwitch")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.continue_text),
            onClick = onContinueClick,
            isEnabled = state.isContinueButtonEnabled,
            modifier = Modifier
                .testTag("ContinueButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        VowkeyTextButton(
            label = stringResource(id = R.string.vk_local_continue),
            onClick = onContinueWithoutAccountClick,
            modifier = Modifier
                .testTag("ContinueWithoutAccountButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        AnimatedVisibility(
            visible = state.allowCreateAccount,
            label = "CreateAccountAnimatedVisibility",
        ) {
            Column {
                Row(
                    horizontalArrangement = Arrangement.Center,
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .wrapContentHeight(),
                ) {
                    Text(
                        text = stringResource(id = VowkeyString.new_to_vowkey),
                        style = VowkeyTheme.typography.bodyMedium,
                        color = VowkeyTheme.colorScheme.text.secondary,
                    )

                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.create_an_account),
                        onClick = onCreateAccountClick,
                        modifier = Modifier
                            .testTag("CreateAccountLabel"),
                    )
                }
                Spacer(modifier = Modifier.height(height = 8.dp))
            }
        }
        VowkeyTextButton(
            label = stringResource(id = VowkeyString.app_settings),
            onClick = onAppSettingsClick,
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_cog),
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 12.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}
