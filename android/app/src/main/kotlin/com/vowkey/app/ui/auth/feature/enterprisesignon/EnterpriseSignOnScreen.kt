package com.vowkey.app.ui.auth.feature.enterprisesignon

import androidx.compose.foundation.layout.Column
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
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.R
import com.vowkey.app.ui.platform.composition.LocalAuthTabLaunchers
import com.vowkey.app.ui.platform.model.AuthTabLaunchers

/**
 * The top level composable for the Enterprise Single Sign On screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EnterpriseSignOnScreen(
    onNavigateBack: () -> Unit,
    onNavigateToSetPassword: () -> Unit,
    onNavigateToTwoFactorLogin: (email: String, orgIdentifier: String) -> Unit,
    authTabLaunchers: AuthTabLaunchers = LocalAuthTabLaunchers.current,
    intentManager: IntentManager = LocalIntentManager.current,
    viewModel: EnterpriseSignOnViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            EnterpriseSignOnEvent.NavigateBack -> onNavigateBack()

            is EnterpriseSignOnEvent.NavigateToSsoLogin -> {
                intentManager.startAuthTab(
                    uri = event.uri,
                    authTabData = event.authTabData,
                    launcher = authTabLaunchers.sso,
                )
            }

            is EnterpriseSignOnEvent.NavigateToSetPassword -> {
                onNavigateToSetPassword()
            }

            is EnterpriseSignOnEvent.NavigateToTwoFactorLogin -> {
                onNavigateToTwoFactorLogin(event.emailAddress, event.orgIdentifier)
            }
        }
    }

    EnterpriseSignOnDialogs(
        dialogState = state.dialogState,
        onConfirmKeyConnectorDomain = {
            viewModel.trySendAction(EnterpriseSignOnAction.ConfirmKeyConnectorDomainClick)
        },
        onDismissKeyConnectorDomain = {
            viewModel.trySendAction(EnterpriseSignOnAction.CancelKeyConnectorDomainClick)
        },
        onDismissRequest = { viewModel.trySendAction(EnterpriseSignOnAction.DialogDismiss) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = R.string.app_name),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(EnterpriseSignOnAction.CloseButtonClick)
                },
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.log_in_verb),
                        onClick = { viewModel.trySendAction(EnterpriseSignOnAction.LogInClick) },
                        modifier = Modifier.testTag("LoginButton"),
                    )
                },
            )
        },
    ) {
        EnterpriseSignOnScreenContent(
            state = state,
            onOrgIdentifierInputChange = {
                viewModel.trySendAction(EnterpriseSignOnAction.OrgIdentifierInputChange(it))
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun EnterpriseSignOnScreenContent(
    state: EnterpriseSignOnState,
    onOrgIdentifierInputChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .fillMaxWidth(),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        Text(
            text = stringResource(id = VowkeyString.log_in_sso_summary),
            textAlign = TextAlign.Start,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 8.dp))

        VowkeyTextField(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
            value = state.orgIdentifierInput,
            onValueChange = onOrgIdentifierInputChange,
            label = stringResource(id = VowkeyString.org_identifier),
            textFieldTestTag = "OrgSSOIdentifierEntry",
            cardStyle = CardStyle.Full,
        )

        Spacer(modifier = Modifier.height(16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun EnterpriseSignOnDialogs(
    dialogState: EnterpriseSignOnState.DialogState?,
    onDismissRequest: () -> Unit,
    onConfirmKeyConnectorDomain: () -> Unit,
    onDismissKeyConnectorDomain: () -> Unit,
) {
    when (dialogState) {
        is EnterpriseSignOnState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                throwable = dialogState.error,
                onDismissRequest = onDismissRequest,
            )
        }

        is EnterpriseSignOnState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        is EnterpriseSignOnState.DialogState.KeyConnectorDomain -> {
            VowkeyTwoButtonDialog(
                title = stringResource(VowkeyString.confirm_key_connector_domain),
                message = stringResource(
                    VowkeyString.please_confirm_domain_with_admin,
                    dialogState.keyConnectorDomain,
                ),
                confirmButtonText = stringResource(VowkeyString.confirm),
                dismissButtonText = stringResource(VowkeyString.cancel),
                onConfirmClick = onConfirmKeyConnectorDomain,
                onDismissRequest = onDismissKeyConnectorDomain,
                onDismissClick = onDismissKeyConnectorDomain,
            )
        }

        null -> Unit
    }
}
