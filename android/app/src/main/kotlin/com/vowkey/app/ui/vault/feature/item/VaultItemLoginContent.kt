package com.vowkey.app.ui.vault.feature.item

import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.model.VowkeyHelpButtonData
import com.vowkey.ui.platform.components.field.VowkeyHiddenPasswordField
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.indicator.VowkeyCircularCountdownIndicator
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.item.component.itemHeader
import com.vowkey.app.ui.vault.feature.item.component.vaultItemAttachments
import com.vowkey.app.ui.vault.feature.item.component.vaultItemCustomFields
import com.vowkey.app.ui.vault.feature.item.component.vaultItemHistory
import com.vowkey.app.ui.vault.feature.item.component.vaultItemNotes
import com.vowkey.app.ui.vault.feature.item.handlers.VaultCommonItemTypeHandlers
import com.vowkey.app.ui.vault.feature.item.handlers.VaultLoginItemTypeHandlers
import com.vowkey.app.ui.vault.feature.item.model.TotpCodeItemData

private const val AUTH_CODE_SPACING_INTERVAL = 3

/**
 * The top level content UI state for the [VaultItemScreen] when viewing a Login cipher.
 */
@Suppress("LongMethod")
@Composable
fun VaultItemLoginContent(
    commonState: VaultItemState.ViewState.Content.Common,
    loginItemState: VaultItemState.ViewState.Content.ItemType.Login,
    vaultCommonItemTypeHandlers: VaultCommonItemTypeHandlers,
    vaultLoginItemTypeHandlers: VaultLoginItemTypeHandlers,
    modifier: Modifier = Modifier,
) {
    var isExpanded by rememberSaveable { mutableStateOf(value = false) }
    LazyColumn(
        modifier = modifier.fillMaxWidth(),
    ) {
        item {
            Spacer(Modifier.height(height = 12.dp))
        }
        itemHeader(
            value = commonState.name,
            isFavorite = commonState.favorite,
            isArchived = commonState.archived,
            iconData = commonState.iconData,
            relatedLocations = commonState.relatedLocations,
            iconTestTag = "LoginItemNameIcon",
            textFieldTestTag = "LoginItemNameEntry",
            isExpanded = isExpanded,
            onExpandClick = { isExpanded = !isExpanded },
            applyIconBackground = commonState.iconData is IconData.Local,
        )
        if (loginItemState.hasLoginCredentials) {
            item(key = "loginCredentialsHeader") {
                Spacer(modifier = Modifier.height(height = 16.dp))
                VowkeyListHeaderText(
                    label = stringResource(id = VowkeyString.login_credentials),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .padding(horizontal = 16.dp)
                        .animateItem(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
            }
        }

        loginItemState.username?.let { username ->
            item(key = "username") {
                UsernameField(
                    username = username,
                    onCopyUsernameClick = vaultLoginItemTypeHandlers.onCopyUsernameClick,
                    cardStyle = loginItemState
                        .passwordData
                        ?.let { CardStyle.Top(dividerPadding = 0.dp) }
                        ?: CardStyle.Full,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        loginItemState.passwordData?.let { passwordData ->
            item(key = "passwordData") {
                PasswordField(
                    passwordData = passwordData,
                    onShowPasswordClick = vaultLoginItemTypeHandlers.onShowPasswordClick,
                    onCheckForBreachClick = vaultLoginItemTypeHandlers.onCheckForBreachClick,
                    onCopyPasswordClick = vaultLoginItemTypeHandlers.onCopyPasswordClick,
                    cardStyle = loginItemState
                        .username
                        ?.let { CardStyle.Bottom }
                        ?: CardStyle.Full,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        loginItemState.fido2CredentialCreationDateText?.let { creationDate ->
            item(key = "creationDate") {
                Spacer(modifier = Modifier.height(8.dp))
                Fido2CredentialField(
                    creationDate = creationDate(),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        loginItemState.totpCodeItemData?.let { totpCodeItemData ->
            item(key = "totpCode") {
                Spacer(modifier = Modifier.height(8.dp))
                TotpField(
                    totpCodeItemData = totpCodeItemData,
                    enabled = loginItemState.canViewTotpCode,
                    onCopyTotpClick = vaultLoginItemTypeHandlers.onCopyTotpCodeClick,
                    onAuthenticatorHelpToolTipClick = vaultLoginItemTypeHandlers
                        .onAuthenticatorHelpToolTipClick,
                    onPremiumRequiredClick = vaultCommonItemTypeHandlers.onPremiumRequiredClick,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        loginItemState.uris.takeUnless { it.isEmpty() }?.let { uris ->
            item(key = "urisHeader") {
                Spacer(modifier = Modifier.height(height = 16.dp))
                VowkeyListHeaderText(
                    label = stringResource(id = VowkeyString.autofill_options),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .padding(horizontal = 16.dp)
                        .animateItem(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
            }

            itemsIndexed(
                items = uris,
                key = { index, _ -> "uri_$index" },
            ) { index, uriData ->
                UriField(
                    uriData = uriData,
                    onCopyUriClick = vaultLoginItemTypeHandlers.onCopyUriClick,
                    onLaunchUriClick = vaultLoginItemTypeHandlers.onLaunchUriClick,
                    cardStyle = uris.toListItemCardStyle(index = index, dividerPadding = 0.dp),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        vaultItemNotes(
            notes = commonState.notes,
            vaultCommonItemTypeHandlers = vaultCommonItemTypeHandlers,
        )

        vaultItemCustomFields(
            customFields = commonState.customFields,
            vaultCommonItemTypeHandlers = vaultCommonItemTypeHandlers,
        )

        vaultItemAttachments(
            attachments = commonState.attachments,
            vaultCommonItemTypeHandlers = vaultCommonItemTypeHandlers,
        )

        vaultItemHistory(
            commonState = commonState,
            vaultCommonItemTypeHandlers = vaultCommonItemTypeHandlers,
            loginPasswordRevisionDate = loginItemState.passwordRevisionDate,
        )

        item {
            Spacer(modifier = Modifier.height(88.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun Fido2CredentialField(
    creationDate: String,
    modifier: Modifier = Modifier,
) {
    VowkeyTextField(
        label = stringResource(id = VowkeyString.passkey),
        value = creationDate,
        onValueChange = { },
        readOnly = true,
        singleLine = true,
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )
}

@Composable
private fun PasswordField(
    passwordData: VaultItemState.ViewState.Content.ItemType.Login.PasswordData,
    onShowPasswordClick: (Boolean) -> Unit,
    onCheckForBreachClick: () -> Unit,
    onCopyPasswordClick: () -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    if (passwordData.canViewPassword) {
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.password),
            value = passwordData.password,
            showPasswordChange = { onShowPasswordClick(it) },
            showPassword = passwordData.isVisible,
            onValueChange = { },
            readOnly = true,
            singleLine = false,
            actions = {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_copy,
                    contentDescription = stringResource(id = VowkeyString.copy_password),
                    onClick = onCopyPasswordClick,
                    modifier = Modifier.testTag(tag = "LoginCopyPasswordButton"),
                )
            },
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                VowkeyClickableText(
                    label = stringResource(id = VowkeyString.check_password_for_data_breaches),
                    style = VowkeyTheme.typography.labelMedium,
                    onClick = onCheckForBreachClick,
                    innerPadding = PaddingValues(all = 16.dp),
                    shape = VowkeyTheme.shapes.contentBottom,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = "LoginCheckPasswordButton"),
                )
            },
            showPasswordTestTag = "LoginViewPasswordButton",
            passwordFieldTestTag = "LoginPasswordEntry",
            cardStyle = cardStyle,
            modifier = modifier,
        )
    } else {
        VowkeyHiddenPasswordField(
            label = stringResource(id = VowkeyString.password),
            value = passwordData.password,
            passwordFieldTestTag = "LoginPasswordEntry",
            cardStyle = cardStyle,
            modifier = modifier,
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun TotpField(
    totpCodeItemData: TotpCodeItemData,
    enabled: Boolean,
    onCopyTotpClick: () -> Unit,
    onAuthenticatorHelpToolTipClick: () -> Unit,
    onPremiumRequiredClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    if (enabled) {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.authenticator_key),
            value = totpCodeItemData.verificationCode
                .chunked(AUTH_CODE_SPACING_INTERVAL)
                .joinToString(" "),
            onValueChange = { },
            textStyle = VowkeyTheme.typography.sensitiveInfoSmall,
            readOnly = true,
            singleLine = true,
            helpData = VowkeyHelpButtonData(
                onClick = onAuthenticatorHelpToolTipClick,
                contentDescription = stringResource(id = VowkeyString.authenticator_key_help),
                isExternalLink = true,
            ),
            actions = {
                VowkeyCircularCountdownIndicator(
                    timeLeftSeconds = totpCodeItemData.timeLeftSeconds,
                    periodSeconds = totpCodeItemData.periodSeconds,
                )
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_copy,
                    contentDescription = stringResource(id = VowkeyString.copy_totp),
                    onClick = onCopyTotpClick,
                    modifier = Modifier.testTag(tag = "LoginCopyTotpButton"),
                )
            },
            textFieldTestTag = "LoginTotpEntry",
            cardStyle = CardStyle.Full,
            modifier = modifier,
        )
    } else {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.authenticator_key),
            value = "",
            helpData = VowkeyHelpButtonData(
                onClick = onAuthenticatorHelpToolTipClick,
                contentDescription = stringResource(id = VowkeyString.authenticator_key_help),
                isExternalLink = true,
            ),
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                VowkeyClickableText(
                    label = stringResource(id = VowkeyString.premium_subscription_required),
                    onClick = onPremiumRequiredClick,
                    style = VowkeyTheme.typography.labelMedium,
                    innerPadding = PaddingValues(all = 16.dp),
                    shape = VowkeyTheme.shapes.contentBottom,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = "TotpPremiumRequiredButton"),
                )
            },
            enabled = false,
            singleLine = false,
            onValueChange = { },
            readOnly = true,
            cardStyle = CardStyle.Full,
            modifier = modifier,
        )
    }
}

@Composable
private fun UriField(
    uriData: VaultItemState.ViewState.Content.ItemType.Login.UriData,
    onCopyUriClick: (String) -> Unit,
    onLaunchUriClick: (String) -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    VowkeyTextField(
        label = stringResource(id = VowkeyString.website_uri),
        value = uriData.uri,
        onValueChange = { },
        readOnly = true,
        singleLine = false,
        actions = {
            if (uriData.isLaunchable) {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_external_link,
                    contentDescription = stringResource(
                        id = VowkeyString.external_link_format,
                        formatArgs = arrayOf(stringResource(id = VowkeyString.launch)),
                    ),
                    onClick = { onLaunchUriClick(uriData.uri) },
                    modifier = Modifier.testTag(tag = "LoginLaunchUriButton"),
                )
            }
            if (uriData.isCopyable) {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_copy,
                    contentDescription = stringResource(id = VowkeyString.copy),
                    onClick = { onCopyUriClick(uriData.uri) },
                    modifier = Modifier.testTag(tag = "LoginCopyUriButton"),
                )
            }
        },
        textFieldTestTag = "LoginUriEntry",
        cardStyle = cardStyle,
        modifier = modifier,
    )
}

@Composable
private fun UsernameField(
    username: String,
    onCopyUsernameClick: () -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    VowkeyTextField(
        label = stringResource(id = VowkeyString.username),
        value = username,
        onValueChange = { },
        readOnly = true,
        singleLine = false,
        actions = {
            VowkeyStandardIconButton(
                vectorIconRes = VowkeyDrawable.ic_copy,
                contentDescription = stringResource(id = VowkeyString.copy_username),
                onClick = onCopyUsernameClick,
                modifier = Modifier.testTag(tag = "LoginCopyUsernameButton"),
            )
        },
        textFieldTestTag = "LoginUsernameEntry",
        cardStyle = cardStyle,
        modifier = modifier,
    )
}
