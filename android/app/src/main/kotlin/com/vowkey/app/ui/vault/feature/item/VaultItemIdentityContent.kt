package com.vowkey.app.ui.vault.feature.item

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
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
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.item.component.itemHeader
import com.vowkey.app.ui.vault.feature.item.component.vaultItemAttachments
import com.vowkey.app.ui.vault.feature.item.component.vaultItemCustomFields
import com.vowkey.app.ui.vault.feature.item.component.vaultItemHistory
import com.vowkey.app.ui.vault.feature.item.component.vaultItemNotes
import com.vowkey.app.ui.vault.feature.item.handlers.VaultCommonItemTypeHandlers
import com.vowkey.app.ui.vault.feature.item.handlers.VaultIdentityItemTypeHandlers

/**
 * The top level content UI state for the [VaultItemScreen] when viewing a Identity cipher.
 */
@Suppress("LongMethod", "MaxLineLength")
@Composable
fun VaultItemIdentityContent(
    identityState: VaultItemState.ViewState.Content.ItemType.Identity,
    commonState: VaultItemState.ViewState.Content.Common,
    vaultCommonItemTypeHandlers: VaultCommonItemTypeHandlers,
    vaultIdentityItemTypeHandlers: VaultIdentityItemTypeHandlers,
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
            iconTestTag = "IdentityItemNameIcon",
            textFieldTestTag = "IdentityItemNameEntry",
            isExpanded = isExpanded,
            onExpandClick = { isExpanded = !isExpanded },
            applyIconBackground = commonState.iconData is IconData.Local,
        )
        item {
            Spacer(modifier = Modifier.height(height = 8.dp))
        }
        identityState.identityName?.let { identityName ->
            item(key = "identityName") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.identity_name),
                    value = identityName,
                    copyContentDescription = stringResource(id = VowkeyString.copy_identity_name),
                    textFieldTestTag = "IdentityNameEntry",
                    copyActionTestTag = "IdentityCopyNameButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyIdentityNameClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = identityName),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.username?.let { username ->
            item(key = "username") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.username),
                    value = username,
                    copyContentDescription = stringResource(id = VowkeyString.copy_username),
                    textFieldTestTag = "IdentityUsernameEntry",
                    copyActionTestTag = "IdentityCopyUsernameButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyUsernameClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = username),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.company?.let { company ->
            item(key = "company") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.company),
                    value = company,
                    copyContentDescription = stringResource(id = VowkeyString.copy_company),
                    textFieldTestTag = "IdentityCompanyEntry",
                    copyActionTestTag = "IdentityCopyCompanyButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyCompanyClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = company),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.ssn?.let { ssn ->
            item(key = "ssn") {
                VowkeyPasswordField(
                    label = stringResource(id = VowkeyString.ssn),
                    value = ssn,
                    onValueChange = {},
                    readOnly = true,
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(id = VowkeyString.copy_ssn),
                            onClick = vaultIdentityItemTypeHandlers.onCopySsnClick,
                            modifier = Modifier.testTag(tag = "IdentityCopySsnButton"),
                        )
                    },
                    passwordFieldTestTag = "IdentitySsnEntry",
                    showPasswordTestTag = "IdentityViewSsnButton",
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = ssn),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.passportNumber?.let { passportNumber ->
            item(key = "passportNumber") {
                VowkeyPasswordField(
                    label = stringResource(id = VowkeyString.passport_number),
                    value = passportNumber,
                    onValueChange = {},
                    readOnly = true,
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(id = VowkeyString.copy_passport_number),
                            onClick = vaultIdentityItemTypeHandlers.onCopyPassportNumberClick,
                            modifier = Modifier.testTag(tag = "IdentityCopyPassportNumberButton"),
                        )
                    },
                    passwordFieldTestTag = "IdentityPassportNumberEntry",
                    showPasswordTestTag = "IdentityViewPassportNumberButton",
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = passportNumber),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.licenseNumber?.let { licenseNumber ->
            item(key = "licenseNumber") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.license_number),
                    value = licenseNumber,
                    copyContentDescription = stringResource(id = VowkeyString.copy_license_number),
                    textFieldTestTag = "IdentityLicenseNumberEntry",
                    copyActionTestTag = "IdentityCopyLicenseNumberButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyLicenseNumberClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = licenseNumber),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.email?.let { email ->
            item(key = "email") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.email),
                    value = email,
                    copyContentDescription = stringResource(id = VowkeyString.copy_email),
                    textFieldTestTag = "IdentityEmailEntry",
                    copyActionTestTag = "IdentityCopyEmailButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyEmailClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = email),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.phone?.let { phone ->
            item(key = "phone") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.phone),
                    value = phone,
                    copyContentDescription = stringResource(id = VowkeyString.copy_phone),
                    textFieldTestTag = "IdentityPhoneEntry",
                    copyActionTestTag = "IdentityCopyPhoneButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyPhoneClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = phone),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        identityState.address?.let { address ->
            item(key = "address") {
                IdentityCopyField(
                    label = stringResource(id = VowkeyString.address),
                    value = address,
                    copyContentDescription = stringResource(id = VowkeyString.copy_address),
                    textFieldTestTag = "IdentityAddressEntry",
                    copyActionTestTag = "IdentityCopyAddressButton",
                    onCopyClick = vaultIdentityItemTypeHandlers.onCopyAddressClick,
                    cardStyle = identityState
                        .propertyList
                        .toListItemCardStyle(
                            index = identityState.propertyList.indexOf(element = address),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
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
            loginPasswordRevisionDate = null,
        )

        item {
            Spacer(modifier = Modifier.height(88.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun IdentityCopyField(
    label: String,
    value: String,
    copyContentDescription: String,
    textFieldTestTag: String,
    copyActionTestTag: String,
    onCopyClick: () -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    VowkeyTextField(
        label = label,
        value = value,
        onValueChange = { },
        readOnly = true,
        singleLine = false,
        actions = {
            VowkeyStandardIconButton(
                vectorIconRes = VowkeyDrawable.ic_copy,
                contentDescription = copyContentDescription,
                onClick = onCopyClick,
                modifier = Modifier.testTag(tag = copyActionTestTag),
            )
        },
        textFieldTestTag = textFieldTestTag,
        cardStyle = cardStyle,
        modifier = modifier,
    )
}
