package com.vowkey.app.ui.auth.feature.removepassword

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.icon.VowkeyIcon
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText

/**
 * The top level composable for the Remove Password screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RemovePasswordScreen(
    viewModel: RemovePasswordViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    RemovePasswordDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(RemovePasswordAction.DialogDismiss) },
        onConfirmLeaveClick = {
            viewModel.trySendAction(RemovePasswordAction.ConfirmLeaveOrganizationClick)
        },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.remove_master_password),
                scrollBehavior = scrollBehavior,
                navigationIcon = null,
            )
        },
    ) {
        RemovePasswordScreenContent(
            state = state,
            onContinueClick = { viewModel.trySendAction(RemovePasswordAction.ContinueClick) },
            onInputChanged = { viewModel.trySendAction(RemovePasswordAction.InputChanged(it)) },
            onLeaveOrganizationClick = {
                viewModel.trySendAction(RemovePasswordAction.LeaveOrganizationClick)
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
@Suppress("LongMethod")
private fun RemovePasswordScreenContent(
    state: RemovePasswordState,
    onContinueClick: () -> Unit,
    onInputChanged: (String) -> Unit,
    onLeaveOrganizationClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 24.dp))

        Text(
            text = state.description(),
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))
        RemovePasswordInfoColumn(
            label = state.labelOrg(),
            value = state.orgName?.invoke().orEmpty(),
            icon = IconData.Local(iconRes = VowkeyDrawable.ic_organization),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(
                    cardStyle = CardStyle.Top(dividerPadding = 56.dp),
                    paddingBottom = 4.dp,
                ),
        )
        RemovePasswordInfoColumn(
            label = state.labelDomain(),
            value = state.domainName?.invoke().orEmpty(),
            icon = IconData.Local(iconRes = VowkeyDrawable.ic_globe),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .cardStyle(cardStyle = CardStyle.Bottom),
        )
        Spacer(modifier = Modifier.height(height = 24.dp))

        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.master_password),
            value = state.input,
            onValueChange = onInputChanged,
            showPasswordTestTag = "PasswordVisibilityToggle",
            passwordFieldTestTag = "MasterPasswordEntry",
            autoFocus = true,
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.continue_text),
            onClick = onContinueClick,
            isEnabled = state.input.isNotEmpty(),
            modifier = Modifier
                .testTag(tag = "ContinueButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(12.dp))

        VowkeyOutlinedButton(
            label = stringResource(id = VowkeyString.leave_organization),
            onClick = onLeaveOrganizationClick,
            modifier = Modifier
                .testTag("LeaveOrganizationButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun RemovePasswordInfoColumn(
    label: String,
    value: String,
    icon: IconData,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier.defaultMinSize(minHeight = 60.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Spacer(modifier = Modifier.width(width = 12.dp))
        VowkeyIcon(
            iconData = icon,
            tint = VowkeyTheme.colorScheme.icon.secondary,
        )
        Spacer(modifier = Modifier.width(width = 12.dp))
        Column(modifier = Modifier.fillMaxWidth()) {
            Text(
                text = label,
                style = VowkeyTheme.typography.titleSmall,
                color = VowkeyTheme.colorScheme.text.primary,
                modifier = Modifier.fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(height = 4.dp))

            Text(
                text = value,
                style = VowkeyTheme.typography.bodyMedium,
                color = VowkeyTheme.colorScheme.text.secondary,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}

@Composable
private fun RemovePasswordDialogs(
    dialogState: RemovePasswordState.DialogState?,
    onDismissRequest: () -> Unit,
    onConfirmLeaveClick: () -> Unit,
) {
    when (dialogState) {
        is RemovePasswordState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = onDismissRequest,
            )
        }

        is RemovePasswordState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.title())
        }

        is RemovePasswordState.DialogState.LeaveConfirmationPrompt -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.leave_organization),
                message = dialogState.message.invoke(),
                confirmButtonText = stringResource(id = VowkeyString.confirm),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = onConfirmLeaveClick,
                onDismissClick = onDismissRequest,
                onDismissRequest = onDismissRequest,
            )
        }

        null -> Unit
    }
}

@Preview(showBackground = true)
@Composable
private fun RemovePasswordScreen_preview() {
    VowkeyTheme {
        RemovePasswordScreenContent(
            state = RemovePasswordState(
                input = "",
                description =
                    ("A master password is no longer required " +
                        "for members of the following organization. " +
                        "Please confirm the domain below with your " +
                        "organization administrator.").asText(),
                labelOrg = "Organization name".asText(),
                orgName = "Organization name".asText(),
                labelDomain = "Key Connector domain".asText(),
                domainName = "http://localhost:8080".asText(),
                dialogState = null,
                organizationId = null,
            ),
            onContinueClick = { },
            onInputChanged = { },
            onLeaveOrganizationClick = { },
        )
    }
}
