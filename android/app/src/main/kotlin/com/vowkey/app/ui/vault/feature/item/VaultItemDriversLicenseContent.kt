package com.vowkey.app.ui.vault.feature.item

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
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
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
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
import com.vowkey.app.ui.vault.feature.item.handlers.VaultDriversLicenseItemTypeHandlers

/**
 * The top level content UI state for the [VaultItemScreen] when viewing a driver's license
 * cipher. Each populated field renders as a separate read-only row.
 */
@Suppress("LongMethod")
@Composable
fun VaultItemDriversLicenseContent(
    commonState: VaultItemState.ViewState.Content.Common,
    driversLicenseState: VaultItemState.ViewState.Content.ItemType.DriversLicense,
    vaultCommonItemTypeHandlers: VaultCommonItemTypeHandlers,
    vaultDriversLicenseItemTypeHandlers: VaultDriversLicenseItemTypeHandlers,
    modifier: Modifier = Modifier,
) {
    var isExpanded by rememberSaveable { mutableStateOf(value = false) }
    LazyColumn(modifier = modifier.fillMaxWidth()) {
        item {
            Spacer(Modifier.height(height = 12.dp))
        }
        itemHeader(
            value = commonState.name,
            isFavorite = commonState.favorite,
            isArchived = commonState.archived,
            iconData = commonState.iconData,
            relatedLocations = commonState.relatedLocations,
            iconTestTag = "DriversLicenseItemNameIcon",
            textFieldTestTag = "DriversLicenseItemNameEntry",
            isExpanded = isExpanded,
            onExpandClick = { isExpanded = !isExpanded },
            applyIconBackground = commonState.iconData is IconData.Local,
        )
        item(key = "driversLicenseDetailsHeader") {
            Spacer(modifier = Modifier.height(height = 16.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.license_details),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp)
                    .animateItem(),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        driversLicenseState.firstName?.let { firstName ->
            item(key = "firstName") {
                DriversLicenseCopyField(
                    label = stringResource(id = VowkeyString.first_name),
                    value = firstName,
                    copyContentDescription = stringResource(id = VowkeyString.copy_first_name),
                    textFieldTestTag = "DriversLicenseItemFirstNameEntry",
                    copyActionTestTag = "DriversLicenseCopyFirstNameButton",
                    onCopyClick = vaultDriversLicenseItemTypeHandlers.onCopyFirstNameClick,
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState.propertyList.indexOf(element = firstName),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.middleName?.let { middleName ->
            item(key = "middleName") {
                DriversLicenseCopyField(
                    label = stringResource(id = VowkeyString.middle_name),
                    value = middleName,
                    copyContentDescription = stringResource(id = VowkeyString.copy_middle_name),
                    textFieldTestTag = "DriversLicenseItemMiddleNameEntry",
                    copyActionTestTag = "DriversLicenseCopyMiddleNameButton",
                    onCopyClick = vaultDriversLicenseItemTypeHandlers.onCopyMiddleNameClick,
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState.propertyList.indexOf(element = middleName),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.lastName?.let { lastName ->
            item(key = "lastName") {
                DriversLicenseCopyField(
                    label = stringResource(id = VowkeyString.last_name),
                    value = lastName,
                    copyContentDescription = stringResource(id = VowkeyString.copy_last_name),
                    textFieldTestTag = "DriversLicenseItemLastNameEntry",
                    copyActionTestTag = "DriversLicenseCopyLastNameButton",
                    onCopyClick = vaultDriversLicenseItemTypeHandlers.onCopyLastNameClick,
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState.propertyList.indexOf(element = lastName),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.licenseNumber?.let { licenseNumber ->
            item(key = "licenseNumber") {
                VowkeyPasswordField(
                    label = stringResource(id = VowkeyString.license_number),
                    value = licenseNumber,
                    onValueChange = {},
                    readOnly = true,
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(
                                id = VowkeyString.copy_license_number,
                            ),
                            onClick = vaultDriversLicenseItemTypeHandlers
                                .onCopyLicenseNumberClick,
                            modifier = Modifier.testTag(
                                tag = "DriversLicenseCopyLicenseNumberButton",
                            ),
                        )
                    },
                    passwordFieldTestTag = "DriversLicenseItemLicenseNumberEntry",
                    showPasswordTestTag = "DriversLicenseViewLicenseNumberButton",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = licenseNumber),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.dateOfBirth?.let { dateOfBirth ->
            item(key = "dateOfBirth") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.date_of_birth),
                    value = dateOfBirth,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemDateOfBirthEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = dateOfBirth),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.issuingCountry?.let { issuingCountry ->
            item(key = "issuingCountry") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.issuing_country),
                    value = issuingCountry,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemIssuingCountryEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = issuingCountry),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.issuingState?.let { issuingState ->
            item(key = "issuingState") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.issuing_state),
                    value = issuingState,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemIssuingStateEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = issuingState),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.issuingAuthority?.let { issuingAuthority ->
            item(key = "issuingAuthority") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.issuing_authority),
                    value = issuingAuthority,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemIssuingAuthorityEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = issuingAuthority),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.issueDate?.let { issueDate ->
            item(key = "issueDate") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.issue_date),
                    value = issueDate,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemIssueDateEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = issueDate),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.expirationDate?.let { expirationDate ->
            item(key = "expirationDate") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.expiration_date),
                    value = expirationDate,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemExpirationDateEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = expirationDate),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        driversLicenseState.licenseClass?.let { licenseClass ->
            item(key = "licenseClass") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.license_class),
                    value = licenseClass,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "DriversLicenseItemLicenseClassEntry",
                    cardStyle = driversLicenseState
                        .propertyList
                        .toListItemCardStyle(
                            index = driversLicenseState
                                .propertyList
                                .indexOf(element = licenseClass),
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
private fun DriversLicenseCopyField(
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
        onValueChange = {},
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
