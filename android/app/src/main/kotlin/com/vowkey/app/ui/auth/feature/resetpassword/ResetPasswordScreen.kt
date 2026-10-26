package com.vowkey.app.ui.auth.feature.resetpassword

import androidx.compose.foundation.background
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.card.VowkeyInfoCalloutCard
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyHyperTextLink
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.data.auth.datasource.disk.model.ForcePasswordResetReason
import com.vowkey.app.ui.auth.feature.completeregistration.PasswordStrengthIndicator
import com.vowkey.app.ui.auth.feature.completeregistration.PasswordStrengthState
import kotlinx.collections.immutable.persistentListOf

/**
 * The top level composable for the Reset Password screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod")
fun ResetPasswordScreen(
    onNavigateToPreventAccountLockOut: () -> Unit,
    viewModel: ResetPasswordViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            ResetPasswordEvent.NavigateToPreventAccountLockout -> {
                onNavigateToPreventAccountLockOut()
            }
        }
    }

    when (val dialog = state.dialogState) {
        is ResetPasswordState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialog.title?.invoke(),
                message = dialog.message(),
                onDismissRequest = { viewModel.trySendAction(ResetPasswordAction.DialogDismiss) },
            )
        }

        is ResetPasswordState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialog.message())
        }

        null -> Unit
    }

    var shouldShowLogoutConfirmationDialog by rememberSaveable { mutableStateOf(false) }
    val onLogoutClicked = { viewModel.trySendAction(ResetPasswordAction.ConfirmLogoutClick) }
    if (shouldShowLogoutConfirmationDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.log_out),
            message = stringResource(id = VowkeyString.logout_confirmation),
            confirmButtonText = stringResource(id = VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowLogoutConfirmationDialog = false
                onLogoutClicked()
            },
            onDismissClick = { shouldShowLogoutConfirmationDialog = false },
            onDismissRequest = { shouldShowLogoutConfirmationDialog = false },
        )
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.update_master_password),
                navigationIcon = null,
                scrollBehavior = scrollBehavior,
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        onClick = { viewModel.trySendAction(ResetPasswordAction.SaveClick) },
                        modifier = Modifier.testTag("SaveButton"),
                    )
                    VowkeyOverflowActionItem(
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(VowkeyString.log_out),
                                onClick = { shouldShowLogoutConfirmationDialog = true },
                            ),
                        ),
                    )
                },
            )
        },
    ) {
        ResetPasswordScreenContent(
            state = state,
            onCurrentPasswordInputChanged = {
                viewModel.trySendAction(ResetPasswordAction.CurrentPasswordInputChanged(it))
            },
            onPasswordInputChanged = {
                viewModel.trySendAction(ResetPasswordAction.PasswordInputChanged(it))
            },
            onRetypePasswordInputChanged = {
                viewModel.trySendAction(ResetPasswordAction.RetypePasswordInputChanged(it))
            },
            onPasswordHintInputChanged = {
                viewModel.trySendAction(ResetPasswordAction.PasswordHintInputChanged(it))
            },
            onLearnToPreventLockout = {
                viewModel.trySendAction(ResetPasswordAction.LearnHowPreventLockoutClick)
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
@Suppress("LongMethod")
private fun ResetPasswordScreenContent(
    state: ResetPasswordState,
    onCurrentPasswordInputChanged: (String) -> Unit,
    onPasswordInputChanged: (String) -> Unit,
    onRetypePasswordInputChanged: (String) -> Unit,
    onPasswordHintInputChanged: (String) -> Unit,
    onLearnToPreventLockout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        val instructionsTextId =
            if (state.resetReason == ForcePasswordResetReason.WEAK_MASTER_PASSWORD_ON_LOGIN) {
                VowkeyString.update_weak_master_password_warning
            } else {
                VowkeyString.update_master_password_warning
            }
        VowkeyInfoCalloutCard(
            text = stringResource(id = instructionsTextId),
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (state.resetReason == ForcePasswordResetReason.WEAK_MASTER_PASSWORD_ON_LOGIN) {
            val passwordPolicyContent = listOf(
                stringResource(id = VowkeyString.master_password_policy_in_effect),
            )
                .plus(state.policies.map { it() })
                .joinToString("\n  •  ")
            VowkeyInfoCalloutCard(
                text = passwordPolicyContent,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))
            VowkeyPasswordField(
                label = stringResource(id = VowkeyString.current_master_password_required),
                value = state.currentPasswordInput,
                onValueChange = onCurrentPasswordInputChanged,
                passwordFieldTestTag = "MasterPasswordField",
                cardStyle = CardStyle.Top(dividerPadding = 0.dp),
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
        }

        var isPasswordVisible by rememberSaveable { mutableStateOf(false) }
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.new_master_password_required),
            value = state.passwordInput,
            onValueChange = onPasswordInputChanged,
            showPassword = isPasswordVisible,
            showPasswordChange = { isPasswordVisible = it },
            passwordFieldTestTag = "NewPasswordField",
            supportingContent = {
                PasswordStrengthIndicator(
                    state = state.passwordStrengthState,
                    currentCharacterCount = state.passwordInput.length,
                    minimumCharacterCount = state.minimumPasswordLength,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            cardStyle = if (
                state.resetReason == ForcePasswordResetReason.WEAK_MASTER_PASSWORD_ON_LOGIN) {
                CardStyle.Middle(dividerPadding = 0.dp)
            } else {
                CardStyle.Top(dividerPadding = 0.dp)
            },
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.retype_new_master_password_required),
            value = state.retypePasswordInput,
            onValueChange = onRetypePasswordInputChanged,
            showPassword = isPasswordVisible,
            showPasswordChange = { isPasswordVisible = it },
            passwordFieldTestTag = "RetypePasswordField",
            cardStyle = CardStyle.Middle(dividerPadding = 0.dp),
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        VowkeyTextField(
            label = stringResource(id = VowkeyString.new_master_password_hint),
            value = state.passwordHintInput,
            onValueChange = onPasswordHintInputChanged,
            supportingContent = {
                Column {
                    Text(
                        text = stringResource(
                            VowkeyString
                                .vowkey_cannot_reset_a_lost_or_forgotten_master_password,
                        ),
                        style = VowkeyTheme.typography.bodySmall,
                        color = VowkeyTheme.colorScheme.text.secondary,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    VowkeyHyperTextLink(
                        annotatedResId =
                            VowkeyString.learn_about_ways_to_prevent_account_lockout,
                        annotationKey = "onPreventAccountLockout",
                        accessibilityString = stringResource(
                            VowkeyString.learn_about_ways_to_prevent_account_lockout,
                        ),
                        onClick = onLearnToPreventLockout,
                    )
                }
            },
            textFieldTestTag = "MasterPasswordHintLabel",
            cardStyle = CardStyle.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Preview
@Composable
private fun ResetPasswordScreenContent_preview() {
    VowkeyTheme {
        ResetPasswordScreenContent(
            state = ResetPasswordState(
                policies = listOf(),
                resetReason = null,
                dialogState = null,
                currentPasswordInput = "",
                passwordInput = "",
                retypePasswordInput = "",
                passwordHintInput = "",
                passwordStrengthState = PasswordStrengthState.GOOD,
                minimumPasswordLength = 12,
            ),
            onCurrentPasswordInputChanged = {},
            onPasswordInputChanged = {},
            onRetypePasswordInputChanged = {},
            onPasswordHintInputChanged = {},
            onLearnToPreventLockout = {},
            modifier = Modifier
                .fillMaxSize()
                .background(VowkeyTheme.colorScheme.background.primary),
        )
    }
}
