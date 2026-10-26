package com.vowkey.app.ui.vault.feature.addedit

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.adaptive.WindowAdaptiveInfo
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.model.VowkeyHelpButtonData
import com.vowkey.ui.platform.components.coachmark.CoachMarkActionText
import com.vowkey.ui.platform.components.coachmark.model.CoachMarkHighlightShape
import com.vowkey.ui.platform.components.coachmark.scope.CoachMarkScope
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyHiddenPasswordField
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.repository.model.UriMatchType
import com.vowkey.app.ui.vault.feature.addedit.handlers.VaultAddEditLoginTypeHandlers

/**
 * The UI for adding and editing a login cipher.
 */
@Suppress("LongMethod", "LongParameterList")
fun LazyListScope.vaultAddEditLoginItems(
    coachMarkScope: CoachMarkScope<AddEditItemCoachMark>,
    loginState: VaultAddEditState.ViewState.Content.ItemType.Login,
    loginItemTypeHandlers: VaultAddEditLoginTypeHandlers,
    windowAdaptiveInfo: WindowAdaptiveInfo,
    onTotpSetupClick: () -> Unit,
    onNextCoachMark: () -> Unit,
    onPreviousCoachMark: () -> Unit,
    onCoachMarkTourComplete: () -> Unit,
    onCoachMarkDismissed: () -> Unit,
    defaultUriMatchType: UriMatchType,
) = coachMarkScope.run {
    item {
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.login_credentials),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
    }

    item {
        Spacer(modifier = Modifier.height(8.dp))
        UsernameRow(
            username = loginState.username,
            loginItemTypeHandlers = loginItemTypeHandlers,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }

    item(key = AddEditItemCoachMark.GENERATE_PASSWORD) {
        PasswordRow(
            password = loginState.password,
            canViewPassword = loginState.canViewPassword,
            loginItemTypeHandlers = loginItemTypeHandlers,
            onGenerateCoachMarkActionClick = onNextCoachMark,
            onCoachMarkDismissed = onCoachMarkDismissed,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }

    loginState.fido2CredentialCreationDateTime?.let { creationDateTime ->
        item {
            Spacer(modifier = Modifier.height(8.dp))
            PasskeyField(
                creationDateTime = creationDateTime,
                canRemovePasskey = loginState.canRemovePasskey,
                loginItemTypeHandlers = loginItemTypeHandlers,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }
    }

    item {
        Spacer(modifier = Modifier.height(height = 8.dp))
    }

    coachMarkHighlightItem(
        key = AddEditItemCoachMark.TOTP,
        title = VowkeyString.coachmark_2_of_3.asText(),
        description = VowkeyString.you_ll_only_need_to_set_up_authenticator_key.asText(),
        onDismiss = onCoachMarkDismissed,
        leftAction = {
            CoachMarkActionText(
                actionLabel = stringResource(VowkeyString.back),
                onActionClick = onPreviousCoachMark,
            )
        },
        rightAction = {
            CoachMarkActionText(
                actionLabel = stringResource(VowkeyString.next),
                onActionClick = onNextCoachMark,
            )
        },
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(windowAdaptiveInfo = windowAdaptiveInfo),
    ) {
        TotpRow(
            totpKey = loginState.totp,
            canViewTotp = loginState.canViewPassword,
            loginItemTypeHandlers = loginItemTypeHandlers,
            onTotpSetupClick = onTotpSetupClick,
            modifier = Modifier.fillMaxWidth(),
        )
    }

    item {
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.autofill_options),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
    }

    coachMarkHighlightItems(
        key = AddEditItemCoachMark.URI,
        title = VowkeyString.coachmark_3_of_3.asText(),
        description = VowkeyString
            .you_must_add_a_web_address_to_use_autofill_to_access_this_account
            .asText(),
        leftAction = {
            CoachMarkActionText(
                actionLabel = stringResource(VowkeyString.back),
                onActionClick = onPreviousCoachMark,
            )
        },
        onDismiss = onCoachMarkDismissed,
        rightAction = {
            CoachMarkActionText(
                actionLabel = stringResource(VowkeyString.done_text),
                onActionClick = onCoachMarkTourComplete,
            )
        },
        trailingContentIsBottomCard = true,
        trailingStaticContent = {
            VowkeyClickableText(
                label = stringResource(id = VowkeyString.add_website),
                onClick = loginItemTypeHandlers.onAddNewUriClick,
                leadingIcon = painterResource(id = VowkeyDrawable.ic_plus_small),
                style = VowkeyTheme.typography.labelMedium,
                innerPadding = PaddingValues(all = 16.dp),
                shape = VowkeyTheme.shapes.contentBottom,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = "LoginAddNewUriButton")
                    .cardStyle(cardStyle = CardStyle.Bottom, paddingVertical = 0.dp),
            )
        },
        items = loginState.uriList,
        modifier = Modifier
            .standardHorizontalMargin(windowAdaptiveInfo = windowAdaptiveInfo),
    ) { uriItem, cardStyle ->
        VaultAddEditUriItem(
            uriItem = uriItem,
            onUriValueChange = loginItemTypeHandlers.onUriValueChange,
            onUriItemRemoved = loginItemTypeHandlers.onRemoveUriClick,
            onLearnMoreClick = loginItemTypeHandlers.onLearnMoreClick,
            cardStyle = cardStyle,
            defaultUriMatchType = defaultUriMatchType,
            modifier = Modifier
                .fillMaxWidth(),
        )
    }
}

@Composable
private fun UsernameRow(
    username: String,
    loginItemTypeHandlers: VaultAddEditLoginTypeHandlers,
    modifier: Modifier = Modifier,
) {
    var shouldShowDialog by rememberSaveable { mutableStateOf(false) }

    VowkeyTextField(
        label = stringResource(id = VowkeyString.username),
        value = username,
        onValueChange = loginItemTypeHandlers.onUsernameTextChange,
        actions = {
            VowkeyStandardIconButton(
                vectorIconRes = VowkeyDrawable.ic_generate,
                contentDescription = stringResource(id = VowkeyString.generate_username),
                onClick = {
                    if (username.isEmpty()) {
                        loginItemTypeHandlers.onOpenUsernameGeneratorClick()
                    } else {
                        shouldShowDialog = true
                    }
                },
                modifier = Modifier.testTag(tag = "GenerateUsernameButton"),
            )
        },
        textFieldTestTag = "LoginUsernameEntry",
        cardStyle = CardStyle.Top(dividerPadding = 0.dp),
        modifier = modifier,
    )

    if (shouldShowDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.username),
            message = stringResource(
                id = VowkeyString.are_you_sure_you_want_to_overwrite_the_current_username,
            ),
            confirmButtonText = stringResource(id = VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.no),
            onConfirmClick = {
                shouldShowDialog = false
                loginItemTypeHandlers.onOpenUsernameGeneratorClick()
            },
            onDismissClick = {
                shouldShowDialog = false
            },
            onDismissRequest = {
                shouldShowDialog = false
            },
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun CoachMarkScope<AddEditItemCoachMark>.PasswordRow(
    password: String,
    canViewPassword: Boolean,
    loginItemTypeHandlers: VaultAddEditLoginTypeHandlers,
    onGenerateCoachMarkActionClick: () -> Unit,
    onCoachMarkDismissed: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var shouldShowDialog by rememberSaveable { mutableStateOf(false) }

    if (canViewPassword) {
        var shouldShowPassword by remember { mutableStateOf(false) }
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.password),
            value = password,
            onValueChange = loginItemTypeHandlers.onPasswordTextChange,
            showPassword = shouldShowPassword,
            showPasswordChange = {
                shouldShowPassword = !shouldShowPassword
                loginItemTypeHandlers.onPasswordVisibilityChange(shouldShowPassword)
            },
            showPasswordTestTag = "ViewPasswordButton",
            passwordFieldTestTag = "LoginPasswordEntry",
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                VowkeyClickableText(
                    label = stringResource(id = VowkeyString.check_password_for_data_breaches),
                    style = VowkeyTheme.typography.labelMedium,
                    onClick = loginItemTypeHandlers.onPasswordCheckerClick,
                    innerPadding = PaddingValues(all = 16.dp),
                    shape = VowkeyTheme.shapes.contentBottom,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = "CheckPasswordButton"),
                )
            },
            cardStyle = CardStyle.Bottom,
            modifier = modifier,
        ) {
            CoachMarkHighlight(
                key = AddEditItemCoachMark.GENERATE_PASSWORD,
                title = stringResource(VowkeyString.coachmark_1_of_3),
                description = stringResource(
                    VowkeyString.use_this_button_to_generate_a_new_unique_password,
                ),
                shape = CoachMarkHighlightShape.Oval,
                onDismiss = onCoachMarkDismissed,
                leftAction = null,
                rightAction = {
                    CoachMarkActionText(
                        actionLabel = stringResource(VowkeyString.next),
                        onActionClick = onGenerateCoachMarkActionClick,
                    )
                },
            ) {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_generate,
                    contentDescription = stringResource(id = VowkeyString.generate_password),
                    onClick = {
                        if (password.isEmpty()) {
                            loginItemTypeHandlers.onOpenPasswordGeneratorClick()
                        } else {
                            shouldShowDialog = true
                        }
                    },
                    modifier = Modifier.testTag(tag = "RegeneratePasswordButton"),
                )
            }

            if (shouldShowDialog) {
                VowkeyTwoButtonDialog(
                    title = stringResource(id = VowkeyString.password),
                    message = stringResource(id = VowkeyString.password_override_alert),
                    confirmButtonText = stringResource(id = VowkeyString.yes),
                    dismissButtonText = stringResource(id = VowkeyString.no),
                    onConfirmClick = {
                        shouldShowDialog = false
                        loginItemTypeHandlers.onOpenPasswordGeneratorClick()
                    },
                    onDismissClick = {
                        shouldShowDialog = false
                    },
                    onDismissRequest = {
                        shouldShowDialog = false
                    },
                )
            }
        }
    } else {
        VowkeyHiddenPasswordField(
            label = stringResource(id = VowkeyString.password),
            value = password,
            passwordFieldTestTag = "LoginPasswordEntry",
            cardStyle = CardStyle.Bottom,
            modifier = modifier,
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun TotpRow(
    totpKey: String?,
    canViewTotp: Boolean,
    loginItemTypeHandlers: VaultAddEditLoginTypeHandlers,
    onTotpSetupClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (!canViewTotp && totpKey != null) {
        VowkeyHiddenPasswordField(
            label = stringResource(id = VowkeyString.authenticator_key),
            value = totpKey,
            passwordFieldTestTag = "LoginTotpEntry",
            cardStyle = CardStyle.Full,
            modifier = modifier.fillMaxWidth(),
        )
        return
    }
    VowkeyPasswordField(
        label = stringResource(id = VowkeyString.authenticator_key),
        value = totpKey.orEmpty(),
        onValueChange = {},
        readOnly = true,
        singleLine = true,
        actions = {
            totpKey?.let {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_clear,
                    contentDescription = stringResource(id = VowkeyString.delete),
                    onClick = loginItemTypeHandlers.onClearTotpKeyClick,
                )
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_copy,
                    contentDescription = stringResource(id = VowkeyString.copy_totp),
                    onClick = { loginItemTypeHandlers.onCopyTotpKeyClick(totpKey) },
                )
            }
        },
        helpData = VowkeyHelpButtonData(
            onClick = loginItemTypeHandlers.onAuthenticatorHelpToolTipClick,
            contentDescription = stringResource(id = VowkeyString.authenticator_key_help),
            isExternalLink = true,
        ),
        supportingContentPadding = PaddingValues(),
        supportingContent = {
            VowkeyClickableText(
                label = stringResource(id = VowkeyString.set_up_authenticator_key),
                onClick = onTotpSetupClick,
                leadingIcon = painterResource(id = VowkeyDrawable.ic_camera_small),
                style = VowkeyTheme.typography.labelMedium,
                innerPadding = PaddingValues(all = 16.dp),
                isEnabled = canViewTotp,
                shape = VowkeyTheme.shapes.contentBottom,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("SetupTotpButton"),
            )
        },
        passwordFieldTestTag = "LoginTotpEntry",
        cardStyle = CardStyle.Full,
        modifier = modifier
            .fillMaxWidth()
            .focusProperties { canFocus = false },
    )
}

@Composable
private fun PasskeyField(
    creationDateTime: Text,
    canRemovePasskey: Boolean,
    loginItemTypeHandlers: VaultAddEditLoginTypeHandlers,
    modifier: Modifier = Modifier,
) {
    VowkeyTextField(
        label = stringResource(id = VowkeyString.passkey),
        value = creationDateTime.invoke(),
        onValueChange = { },
        readOnly = true,
        singleLine = true,
        actions = {
            if (canRemovePasskey) {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_minus,
                    contentDescription = stringResource(id = VowkeyString.remove_passkey),
                    onClick = loginItemTypeHandlers.onClearFido2CredentialClick,
                    modifier = Modifier.testTag(tag = "RemovePasskeyButton"),
                )
            }
        },
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )
}
