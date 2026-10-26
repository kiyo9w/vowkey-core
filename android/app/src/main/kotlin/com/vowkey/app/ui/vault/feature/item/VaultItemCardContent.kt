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
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.item.component.itemHeader
import com.vowkey.app.ui.vault.feature.item.component.vaultItemAttachments
import com.vowkey.app.ui.vault.feature.item.component.vaultItemCustomFields
import com.vowkey.app.ui.vault.feature.item.component.vaultItemHistory
import com.vowkey.app.ui.vault.feature.item.component.vaultItemNotes
import com.vowkey.app.ui.vault.feature.item.handlers.VaultCardItemTypeHandlers
import com.vowkey.app.ui.vault.feature.item.handlers.VaultCommonItemTypeHandlers
import com.vowkey.app.ui.vault.model.VaultCardBrand
import com.vowkey.app.ui.vault.util.shortName

/**
 * The top level content UI state for the [VaultItemScreen] when viewing a Card cipher.
 */
@Suppress("LongMethod")
@Composable
fun VaultItemCardContent(
    commonState: VaultItemState.ViewState.Content.Common,
    cardState: VaultItemState.ViewState.Content.ItemType.Card,
    vaultCommonItemTypeHandlers: VaultCommonItemTypeHandlers,
    vaultCardItemTypeHandlers: VaultCardItemTypeHandlers,
    modifier: Modifier = Modifier,
) {
    var isExpanded by rememberSaveable { mutableStateOf(value = false) }
    val applyIconBackground = cardState.paymentCardBrandIconData == null
    LazyColumn(modifier = modifier.fillMaxWidth()) {
        item {
            Spacer(Modifier.height(height = 12.dp))
        }
        itemHeader(
            value = commonState.name,
            isFavorite = commonState.favorite,
            isArchived = commonState.archived,
            iconData = cardState.paymentCardBrandIconData ?: commonState.iconData,
            relatedLocations = commonState.relatedLocations,
            iconTestTag = "CardItemNameIcon",
            textFieldTestTag = "CardItemNameEntry",
            isExpanded = isExpanded,
            onExpandClick = { isExpanded = !isExpanded },
            applyIconBackground = applyIconBackground,
        )
        item {
            Spacer(modifier = Modifier.height(height = 8.dp))
        }
        cardState.cardholderName?.let { cardholderName ->
            item(key = "cardholderName") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.cardholder_name),
                    value = cardholderName,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "CardholderNameEntry",
                    cardStyle = cardState
                        .propertyList
                        .toListItemCardStyle(
                            index = cardState.propertyList.indexOf(element = cardholderName),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }
        cardState.number?.let { numberData ->
            item(key = "cardNumber") {
                VowkeyPasswordField(
                    label = stringResource(id = VowkeyString.number),
                    value = numberData.number,
                    onValueChange = {},
                    showPassword = numberData.isVisible,
                    showPasswordChange = vaultCardItemTypeHandlers.onShowNumberClick,
                    readOnly = true,
                    singleLine = false,
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(id = VowkeyString.copy_number),
                            onClick = vaultCardItemTypeHandlers.onCopyNumberClick,
                            modifier = Modifier.testTag(tag = "CardCopyNumberButton"),
                        )
                    },
                    passwordFieldTestTag = "CardNumberEntry",
                    showPasswordTestTag = "CardViewNumberButton",
                    cardStyle = cardState
                        .propertyList
                        .toListItemCardStyle(
                            index = cardState.propertyList.indexOf(element = numberData),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        if (cardState.brand != null && cardState.brand != VaultCardBrand.SELECT) {
            item(key = "cardBrand") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.brand),
                    value = cardState.brand.shortName(),
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "CardBrandEntry",
                    cardStyle = cardState
                        .propertyList
                        .toListItemCardStyle(
                            index = cardState.propertyList.indexOf(element = cardState.brand),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        cardState.expiration?.let { expiration ->
            item(key = "expiration") {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.expiration),
                    value = expiration,
                    onValueChange = {},
                    readOnly = true,
                    singleLine = false,
                    textFieldTestTag = "CardExpirationEntry",
                    cardStyle = cardState
                        .propertyList
                        .toListItemCardStyle(
                            index = cardState.propertyList.indexOf(element = expiration),
                            dividerPadding = 0.dp,
                        ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        cardState.securityCode?.let { securityCodeData ->
            item(key = "securityCode") {
                VowkeyPasswordField(
                    label = stringResource(id = VowkeyString.security_code),
                    value = securityCodeData.code,
                    onValueChange = {},
                    showPassword = securityCodeData.isVisible,
                    showPasswordChange = vaultCardItemTypeHandlers.onShowSecurityCodeClick,
                    readOnly = true,
                    singleLine = false,
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(
                                id = VowkeyString.copy_security_code,
                            ),
                            onClick = vaultCardItemTypeHandlers.onCopySecurityCodeClick,
                            modifier = Modifier.testTag(tag = "CardCopySecurityCodeButton"),
                        )
                    },
                    showPasswordTestTag = "CardViewSecurityCodeButton",
                    passwordFieldTestTag = "CardSecurityCodeEntry",
                    cardStyle = cardState
                        .propertyList
                        .toListItemCardStyle(
                            index = cardState.propertyList.indexOf(element = securityCodeData),
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
