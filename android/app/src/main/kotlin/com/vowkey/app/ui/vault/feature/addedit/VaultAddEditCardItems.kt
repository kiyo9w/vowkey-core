package com.vowkey.app.ui.vault.feature.addedit

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.addedit.handlers.VaultAddEditCardTypeHandlers
import com.vowkey.app.ui.vault.model.VaultCardBrand
import com.vowkey.app.ui.vault.model.VaultCardExpirationMonth
import com.vowkey.app.ui.vault.util.longName
import kotlinx.collections.immutable.toImmutableList

/**
 * The UI for adding and editing a card cipher.
 */
@Suppress("LongMethod")
fun LazyListScope.vaultAddEditCardItems(
    cardState: VaultAddEditState.ViewState.Content.ItemType.Card,
    isCardScannerEnabled: Boolean,
    cardHolderNameFocusRequester: FocusRequester,
    onScanCardClick: () -> Unit,
    cardHandlers: VaultAddEditCardTypeHandlers,
) {
    item {
        Spacer(modifier = Modifier.height(16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.card_details),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
    }

    if (isCardScannerEnabled) {
        item {
            Spacer(modifier = Modifier.height(8.dp))
            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.scan_card),
                onClick = onScanCardClick,
                icon = rememberVectorPainter(id = VowkeyDrawable.ic_camera_small),
                modifier = Modifier
                    .testTag("ScanCardButton")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }
    }

    item {
        Spacer(modifier = Modifier.height(8.dp))
        VowkeyTextField(
            label = stringResource(id = VowkeyString.cardholder_name),
            value = cardState.cardHolderName,
            onValueChange = cardHandlers.onCardHolderNameTextChange,
            textFieldTestTag = "CardholderNameEntry",
            cardStyle = CardStyle.Top(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .focusRequester(cardHolderNameFocusRequester),
        )
    }
    item {
        var showNumber by rememberSaveable { mutableStateOf(value = false) }
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.number),
            value = cardState.number,
            onValueChange = cardHandlers.onNumberTextChange,
            showPassword = showNumber,
            showPasswordChange = {
                showNumber = !showNumber
                cardHandlers.onNumberVisibilityChange(showNumber)
            },
            showPasswordTestTag = "ShowCardNumberButton",
            passwordFieldTestTag = "CardNumberEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        val resources = LocalResources.current
        VowkeyMultiSelectButton(
            label = stringResource(id = VowkeyString.brand),
            options = VaultCardBrand
                .entries
                .map { it.longName() }
                .toImmutableList(),
            selectedOption = cardState.brand.longName(),
            onOptionSelected = { selectedString ->
                cardHandlers.onBrandSelected(
                    VaultCardBrand
                        .entries
                        .first { it.longName.toString(resources) == selectedString },
                )
            },
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .testTag("CardBrandPicker")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        val resources = LocalResources.current
        VowkeyMultiSelectButton(
            label = stringResource(id = VowkeyString.expiration_month),
            options = VaultCardExpirationMonth
                .entries
                .map { it.value() }
                .toImmutableList(),
            selectedOption = cardState.expirationMonth.value(),
            onOptionSelected = { selectedString ->
                cardHandlers.onExpirationMonthSelected(
                    VaultCardExpirationMonth
                        .entries
                        .first { it.value.toString(resources) == selectedString },
                )
            },
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .testTag("CardExpirationMonthPicker")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.expiration_year),
            value = cardState.expirationYear,
            onValueChange = cardHandlers.onExpirationYearTextChange,
            keyboardType = KeyboardType.Number,
            textFieldTestTag = "CardExpirationYearEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        var showSecurityCode by rememberSaveable { mutableStateOf(value = false) }
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.security_code),
            value = cardState.securityCode,
            onValueChange = cardHandlers.onSecurityCodeTextChange,
            showPassword = showSecurityCode,
            showPasswordChange = {
                showSecurityCode = !showSecurityCode
                cardHandlers.onSecurityCodeVisibilityChange(showSecurityCode)
            },
            keyboardType = KeyboardType.NumberPassword,
            showPasswordTestTag = "CardShowSecurityCodeButton",
            passwordFieldTestTag = "CardSecurityCodeEntry",
            cardStyle = CardStyle.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
}
