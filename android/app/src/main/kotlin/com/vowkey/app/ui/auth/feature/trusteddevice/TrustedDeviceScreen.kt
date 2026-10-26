package com.vowkey.app.ui.auth.feature.trusteddevice

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
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
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
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.auth.feature.trusteddevice.handlers.TrustedDeviceHandlers

/**
 * The top level composable for the Reset Password screen.
 */
@Composable
fun TrustedDeviceScreen(
    onNavigateToAdminApproval: (emailAddress: String) -> Unit,
    onNavigateToLoginWithOtherDevice: (emailAddress: String) -> Unit,
    onNavigateToLock: (emailAddress: String) -> Unit,
    viewModel: TrustedDeviceViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handlers = remember(viewModel) { TrustedDeviceHandlers.create(viewModel = viewModel) }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is TrustedDeviceEvent.NavigateToApproveWithAdmin -> {
                onNavigateToAdminApproval(event.email)
            }

            is TrustedDeviceEvent.NavigateToApproveWithDevice -> {
                onNavigateToLoginWithOtherDevice(event.email)
            }

            is TrustedDeviceEvent.NavigateToLockScreen -> {
                onNavigateToLock(event.email)
            }
        }
    }

    TrustedDeviceDialogs(
        dialogState = state.dialogState,
        handlers = handlers,
    )

    TrustedDeviceScaffold(
        state = state,
        handlers = handlers,
    )
}

@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TrustedDeviceScaffold(
    state: TrustedDeviceState,
    handlers: TrustedDeviceHandlers,
) {
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.log_in_initiated),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                    navigationIconContentDescription = stringResource(id = VowkeyString.close),
                    onNavigationIconClick = handlers.onBackClick,
                ),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeySwitch(
                label = stringResource(id = VowkeyString.remember_this_device),
                supportingText = stringResource(id = VowkeyString.turn_off_using_public_device),
                isChecked = state.isRemembered,
                onCheckedChange = handlers.onRememberToggle,
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .testTag("RememberThisDeviceSwitch")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(24.dp))

            if (state.showContinueButton) {
                VowkeyFilledButton(
                    label = stringResource(id = VowkeyString.continue_text),
                    onClick = handlers.onContinueClick,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            if (state.showOtherDeviceButton) {
                VowkeyFilledButton(
                    label = stringResource(id = VowkeyString.approve_with_my_other_device),
                    onClick = handlers.onApproveWithDeviceClick,
                    modifier = Modifier
                        .testTag("ApproveWithOtherDeviceButton")
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            if (state.showRequestAdminButton) {
                VowkeyOutlinedButton(
                    label = stringResource(id = VowkeyString.request_admin_approval),
                    onClick = handlers.onApproveWithAdminClick,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .testTag("RequestAdminApprovalButton"),
                )
                Spacer(modifier = Modifier.height(12.dp))
            }

            if (state.showMasterPasswordButton) {
                VowkeyOutlinedButton(
                    label = stringResource(id = VowkeyString.approve_with_master_password),
                    onClick = handlers.onApproveWithPasswordClick,
                    modifier = Modifier
                        .testTag("ApproveWithMasterPasswordButton")
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
                style = VowkeyTheme.typography.bodyMedium,
                color = VowkeyTheme.colorScheme.text.secondary,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .testTag("LoggingInAsLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            VowkeyClickableText(
                label = stringResource(id = VowkeyString.not_you),
                onClick = handlers.onNotYouButtonClick,
                style = VowkeyTheme.typography.labelLarge,
                innerPadding = PaddingValues(vertical = 8.dp, horizontal = 16.dp),
                modifier = Modifier
                    .align(alignment = Alignment.CenterHorizontally)
                    .testTag("NotYouLabel"),
            )

            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun TrustedDeviceDialogs(
    dialogState: TrustedDeviceState.DialogState?,
    handlers: TrustedDeviceHandlers,
) {
    when (dialogState) {
        is TrustedDeviceState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            throwable = dialogState.error,
            onDismissRequest = handlers.onDismissDialog,
        )

        is TrustedDeviceState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        null -> Unit
    }
}

@Preview
@Composable
private fun TrustedDeviceScaffold_preview() {
    VowkeyTheme {
        TrustedDeviceScaffold(
            state = TrustedDeviceState(
                dialogState = null,
                isRemembered = false,
                emailAddress = "email@bitwarden.com",
                environmentLabel = "vault.vowkey.pw",
                showContinueButton = false,
                showOtherDeviceButton = true,
                showRequestAdminButton = true,
                showMasterPasswordButton = true,
            ),
            handlers = TrustedDeviceHandlers(
                onBackClick = {},
                onDismissDialog = {},
                onRememberToggle = {},
                onContinueClick = {},
                onApproveWithAdminClick = {},
                onApproveWithDeviceClick = {},
                onApproveWithPasswordClick = {},
                onNotYouButtonClick = {},
            ),
        )
    }
}
