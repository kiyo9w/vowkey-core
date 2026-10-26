package com.vowkey.app.ui.auth.feature.accountsetup

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.model.WindowSize
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.platform.util.rememberWindowSize
import com.vowkey.app.ui.auth.feature.accountsetup.handlers.SetupUnlockHandler
import com.vowkey.app.ui.platform.components.toggle.VowkeyUnlockWithBiometricsSwitch
import com.vowkey.app.ui.platform.components.toggle.VowkeyUnlockWithPinSwitch
import com.vowkey.app.ui.platform.composition.LocalBiometricsManager
import com.vowkey.app.ui.platform.manager.biometrics.BiometricSupportStatus
import com.vowkey.app.ui.platform.manager.biometrics.BiometricsManager

/**
 * Top level composable for the setup unlock screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun SetupUnlockScreen(
    viewModel: SetupUnlockViewModel = hiltViewModel(),
    biometricsManager: BiometricsManager = LocalBiometricsManager.current,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handler = remember(viewModel) { SetupUnlockHandler.create(viewModel = viewModel) }
    var showBiometricsPrompt by rememberSaveable { mutableStateOf(value = false) }
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is SetupUnlockEvent.ShowBiometricsPrompt -> {
                showBiometricsPrompt = true
                biometricsManager.promptBiometrics(
                    onSuccess = {
                        handler.unlockWithBiometricToggle(it)
                        showBiometricsPrompt = false
                    },
                    onCancel = { showBiometricsPrompt = false },
                    onLockOut = { showBiometricsPrompt = false },
                    onError = { showBiometricsPrompt = false },
                    cipher = event.cipher,
                )
            }

            SetupUnlockEvent.NavigateBack -> onNavigateBack()
        }
    }

    SetupUnlockScreenDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(SetupUnlockAction.DismissDialog) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(
                    id = if (state.isInitialSetup) {
                        VowkeyString.account_setup
                    } else {
                        VowkeyString.set_up_unlock
                    },
                ),
                scrollBehavior = scrollBehavior,
                navigationIcon = if (state.isInitialSetup) {
                    null
                } else {
                    NavigationIcon(
                        navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                        navigationIconContentDescription = stringResource(
                            id = VowkeyString.close,
                        ),
                        onNavigationIconClick = {
                            viewModel.trySendAction(SetupUnlockAction.CloseClick)
                        },
                    )
                },
            )
        },
    ) {
        SetupUnlockScreenContent(
            state = state,
            showBiometricsPrompt = showBiometricsPrompt,
            handler = handler,
            biometricsManager = biometricsManager,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun SetupUnlockScreenContent(
    state: SetupUnlockState,
    showBiometricsPrompt: Boolean,
    handler: SetupUnlockHandler,
    modifier: Modifier = Modifier,
    biometricsManager: BiometricsManager,
) {
    Column(
        modifier = modifier.verticalScroll(state = rememberScrollState()),
    ) {
        when (rememberWindowSize()) {
            WindowSize.Compact -> SetupUnlockHeaderCompact()
            WindowSize.Medium -> SetupUnlockHeaderMedium()
        }

        Spacer(modifier = Modifier.height(height = 24.dp))
        val biometricSupportStatus = biometricsManager.biometricSupportStatus
        VowkeyUnlockWithBiometricsSwitch(
            biometricSupportStatus = biometricSupportStatus,
            isChecked = state.isUnlockWithBiometricsEnabled || showBiometricsPrompt,
            onDisableBiometrics = handler.onDisableBiometrics,
            onEnableBiometrics = handler.onEnableBiometrics,
            cardStyle = CardStyle.Top(),
            modifier = Modifier
                .testTag(tag = "UnlockWithBiometricsSwitch")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        VowkeyUnlockWithPinSwitch(
            isUnlockWithPasswordEnabled = state.isUnlockWithPasswordEnabled,
            isUnlockWithPinEnabled = state.isUnlockWithPinEnabled,
            onUnlockWithPinToggleAction = handler.onUnlockWithPinToggle,
            cardStyle = if (biometricSupportStatus == BiometricSupportStatus.NOT_SUPPORTED) {
                CardStyle.Full
            } else {
                CardStyle.Bottom
            },
            modifier = Modifier
                .testTag(tag = "UnlockWithPinSwitch")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.continue_text),
            onClick = handler.onContinueClick,
            isEnabled = state.isContinueButtonEnabled,
            modifier = Modifier
                .testTag(tag = "ContinueButton")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 12.dp))
        if (state.isInitialSetup) {
            SetUpLaterButton(
                onConfirmClick = handler.onSetUpLaterClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 12.dp))
        }
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun SetUpLaterButton(
    modifier: Modifier,
    onConfirmClick: () -> Unit,
) {
    var displayConfirmation by rememberSaveable { mutableStateOf(value = false) }
    if (displayConfirmation) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.set_up_unlock_later),
            message = stringResource(
                id = VowkeyString
                    .you_can_return_to_complete_this_step_anytime_from_account_security_in_settings,
            ),
            confirmButtonText = stringResource(id = VowkeyString.confirm),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                onConfirmClick()
                displayConfirmation = false
            },
            onDismissClick = { displayConfirmation = false },
            onDismissRequest = { displayConfirmation = false },
        )
    }

    VowkeyOutlinedButton(
        label = stringResource(id = VowkeyString.set_up_later),
        onClick = { displayConfirmation = true },
        modifier = modifier.testTag(tag = "SetUpLaterButton"),
    )
}

@Composable
private fun ColumnScope.SetupUnlockHeaderCompact() {
    Spacer(modifier = Modifier.height(height = 32.dp))
    Image(
        painter = rememberVectorPainter(id = VowkeyDrawable.ill_account_setup),
        contentDescription = null,
        modifier = Modifier
            .standardHorizontalMargin()
            .size(size = 100.dp)
            .align(alignment = Alignment.CenterHorizontally),
    )

    Spacer(modifier = Modifier.height(height = 24.dp))
    Text(
        text = stringResource(id = VowkeyString.set_up_unlock),
        style = VowkeyTheme.typography.titleMedium,
        color = VowkeyTheme.colorScheme.text.primary,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )

    Spacer(modifier = Modifier.height(height = 8.dp))
    @Suppress("MaxLineLength")
    Text(
        text = stringResource(
            id = VowkeyString.set_up_biometrics_or_choose_a_pin_code_to_quickly_access_your_vault_and_autofill_your_logins,
        ),
        style = VowkeyTheme.typography.bodyMedium,
        color = VowkeyTheme.colorScheme.text.primary,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )
}

@Composable
private fun SetupUnlockHeaderMedium(
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .padding(horizontal = 112.dp)
            .standardHorizontalMargin(),
    ) {
        Image(
            painter = rememberVectorPainter(id = VowkeyDrawable.ill_account_setup),
            contentDescription = null,
            modifier = Modifier
                .size(size = 100.dp)
                .align(alignment = Alignment.CenterVertically),
        )

        Spacer(modifier = Modifier.width(width = 24.dp))
        Column(
            modifier = Modifier.align(alignment = Alignment.CenterVertically),
        ) {
            Text(
                text = stringResource(id = VowkeyString.set_up_unlock),
                style = VowkeyTheme.typography.titleMedium,
                color = VowkeyTheme.colorScheme.text.primary,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))
            @Suppress("MaxLineLength")
            Text(
                text = stringResource(
                    id = VowkeyString.set_up_biometrics_or_choose_a_pin_code_to_quickly_access_your_vault_and_autofill_your_logins,
                ),
                style = VowkeyTheme.typography.bodyMedium,
                color = VowkeyTheme.colorScheme.text.primary,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun SetupUnlockScreenDialogs(
    dialogState: SetupUnlockState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is SetupUnlockState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.title(),
        )

        is SetupUnlockState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title(),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
        )

        null -> Unit
    }
}
