package com.vowkey.app.ui.platform.feature.settings.accountsecurity.loginapproval

import androidx.activity.compose.BackHandler
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
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.nullableTestTag
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalExitManager
import com.vowkey.ui.platform.manager.exit.ExitManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Displays the login approval screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun LoginApprovalScreen(
    viewModel: LoginApprovalViewModel = hiltViewModel(),
    exitManager: ExitManager = LocalExitManager.current,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            LoginApprovalEvent.ExitApp -> exitManager.exitApplication()
            LoginApprovalEvent.NavigateBack -> onNavigateBack()
        }
    }

    LoginApprovalDialogs(
        state = state.dialogState,
        onDismissError = { viewModel.trySendAction(LoginApprovalAction.ErrorDialogDismiss) },
        onConfirmChangeAccount = {
            viewModel.trySendAction(LoginApprovalAction.ApproveAccountChangeClick)
        },
        onDismissChangeAccount = {
            viewModel.trySendAction(LoginApprovalAction.CancelAccountChangeClick)
        },
    )

    BackHandler(onBack = { viewModel.trySendAction(LoginApprovalAction.CloseClick) })
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.log_in_requested),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(LoginApprovalAction.CloseClick) },
            )
        },
    ) {
        when (val viewState = state.viewState) {
            is LoginApprovalState.ViewState.Content -> {
                LoginApprovalContent(
                    state = viewState,
                    onConfirmLoginClick = {
                        viewModel.trySendAction(LoginApprovalAction.ApproveRequestClick)
                    },
                    onDeclineLoginClick = {
                        viewModel.trySendAction(LoginApprovalAction.DeclineRequestClick)
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is LoginApprovalState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = stringResource(id = VowkeyString.generic_error_message),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is LoginApprovalState.ViewState.Loading -> {
                VowkeyLoadingContent(
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Suppress("LongMethod")
@Composable
private fun LoginApprovalContent(
    state: LoginApprovalState.ViewState.Content,
    onConfirmLoginClick: () -> Unit,
    onDeclineLoginClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(state = rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 24.dp))
        Text(
            text = stringResource(id = VowkeyString.are_you_trying_to_log_in),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        Text(
            text = stringResource(
                id = VowkeyString.log_in_attempt_by_x_on_y,
                state.email,
                state.domainUrl,
            ),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .testTag("LogInAttemptByLabel"),
        )
        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = stringResource(id = VowkeyString.fingerprint_phrase),
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(
                    cardStyle = CardStyle.Top(hasDivider = false),
                    paddingBottom = 4.dp,
                )
                .padding(horizontal = 16.dp),
        )
        Text(
            text = state.fingerprint,
            textAlign = TextAlign.Start,
            color = VowkeyTheme.colorScheme.text.codePink,
            style = VowkeyTheme.typography.sensitiveInfoSmall,
            modifier = Modifier
                .testTag("FingerprintValueLabel")
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(
                    cardStyle = CardStyle.Middle(dividerPadding = 0.dp),
                    paddingTop = 0.dp,
                    paddingStart = 16.dp,
                    paddingEnd = 16.dp,
                ),
        )

        LoginApprovalInfoColumn(
            label = stringResource(id = VowkeyString.device_type),
            value = state.deviceType,
            valueTestTag = "DeviceTypeValueLabel",
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(cardStyle = CardStyle.Middle()),
        )

        LoginApprovalInfoColumn(
            label = stringResource(id = VowkeyString.ip_address),
            value = state.ipAddress,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(cardStyle = CardStyle.Middle()),
        )

        LoginApprovalInfoColumn(
            label = stringResource(id = VowkeyString.time),
            value = state.time,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(cardStyle = CardStyle.Bottom),
        )

        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.confirm_log_in),
            onClick = onConfirmLoginClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .testTag("ConfirmLoginButton"),
        )

        Spacer(modifier = Modifier.height(8.dp))

        VowkeyOutlinedButton(
            label = stringResource(id = VowkeyString.deny_log_in),
            onClick = onDeclineLoginClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .testTag("DenyLoginButton"),
        )

        Spacer(modifier = Modifier.height(height = 12.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

/**
 * A view displaying information about this login approval request.
 */
@Composable
private fun LoginApprovalInfoColumn(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    valueTestTag: String? = null,
) {
    Column(modifier = modifier) {
        Text(
            text = label,
            style = VowkeyTheme.typography.titleSmall,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 4.dp))

        Text(
            text = value,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.secondary,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .nullableTestTag(tag = valueTestTag),
        )
    }
}

@Composable
private fun LoginApprovalDialogs(
    state: LoginApprovalState.DialogState?,
    onDismissError: () -> Unit,
    onConfirmChangeAccount: () -> Unit,
    onDismissChangeAccount: () -> Unit,
) {
    when (state) {
        is LoginApprovalState.DialogState.ChangeAccount -> VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.log_in_requested),
            message = state.message(),
            confirmButtonText = stringResource(id = VowkeyString.okay),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = onConfirmChangeAccount,
            onDismissClick = onDismissChangeAccount,
            onDismissRequest = onDismissChangeAccount,
        )

        is LoginApprovalState.DialogState.Error -> VowkeyBasicDialog(
            title = state.title?.invoke(),
            message = state.message(),
            throwable = state.error,
            onDismissRequest = onDismissError,
        )

        null -> Unit
    }
}
