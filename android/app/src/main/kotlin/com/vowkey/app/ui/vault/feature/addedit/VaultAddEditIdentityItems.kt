package com.vowkey.app.ui.vault.feature.addedit

import android.content.res.Resources
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.addedit.handlers.VaultAddEditIdentityTypeHandlers
import com.vowkey.app.ui.vault.model.VaultIdentityTitle
import kotlinx.collections.immutable.toImmutableList

/**
 * The UI for adding and editing an identity cipher.
 */
@Suppress("LongMethod")
fun LazyListScope.vaultAddEditIdentityItems(
    identityState: VaultAddEditState.ViewState.Content.ItemType.Identity,
    identityItemTypeHandlers: VaultAddEditIdentityTypeHandlers,
) {
    item {
        Spacer(modifier = Modifier.height(16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.personal_details),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
    }

    item {
        Spacer(modifier = Modifier.height(8.dp))
        TitleMultiSelectButton(
            selectedTitle = identityState.selectedTitle,
            onTitleSelected = identityItemTypeHandlers.onTitleSelected,
            modifier = Modifier
                .testTag("IdentityTitlePicker")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.first_name),
            value = identityState.firstName,
            onValueChange = identityItemTypeHandlers.onFirstNameTextChange,
            textFieldTestTag = "IdentityFirstNameEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.middle_name),
            value = identityState.middleName,
            onValueChange = identityItemTypeHandlers.onMiddleNameTextChange,
            textFieldTestTag = "IdentityMiddleNameEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.last_name),
            value = identityState.lastName,
            onValueChange = identityItemTypeHandlers.onLastNameTextChange,
            textFieldTestTag = "IdentityLastNameEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.username),
            value = identityState.username,
            onValueChange = identityItemTypeHandlers.onUsernameTextChange,
            textFieldTestTag = "IdentityUsernameEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.company),
            value = identityState.company,
            onValueChange = identityItemTypeHandlers.onCompanyTextChange,
            textFieldTestTag = "IdentityCompanyEntry",
            cardStyle = CardStyle.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.identification),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
    }
    item {
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.ssn),
            value = identityState.ssn,
            onValueChange = identityItemTypeHandlers.onSsnTextChange,
            showPasswordTestTag = "IdentityShowSsnNumberButton",
            passwordFieldTestTag = "IdentitySsnEntry",
            cardStyle = CardStyle.Top(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyPasswordField(
            label = stringResource(id = VowkeyString.passport_number),
            value = identityState.passportNumber,
            onValueChange = identityItemTypeHandlers.onPassportNumberTextChange,
            showPasswordTestTag = "IdentityShowPassportNumberButton",
            passwordFieldTestTag = "IdentityPassportNumberEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.license_number),
            value = identityState.licenseNumber,
            onValueChange = identityItemTypeHandlers.onLicenseNumberTextChange,
            textFieldTestTag = "IdentityLicenseNumberEntry",
            cardStyle = CardStyle.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.contact_info),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.email),
            value = identityState.email,
            onValueChange = identityItemTypeHandlers.onEmailTextChange,
            textFieldTestTag = "IdentityEmailEntry",
            cardStyle = CardStyle.Top(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.phone),
            value = identityState.phone,
            onValueChange = identityItemTypeHandlers.onPhoneTextChange,
            textFieldTestTag = "IdentityPhoneEntry",
            cardStyle = CardStyle.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.address),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.address1),
            value = identityState.address1,
            onValueChange = identityItemTypeHandlers.onAddress1TextChange,
            textFieldTestTag = "IdentityAddressOneEntry",
            cardStyle = CardStyle.Top(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.address2),
            value = identityState.address2,
            onValueChange = identityItemTypeHandlers.onAddress2TextChange,
            textFieldTestTag = "IdentityAddressTwoEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.address3),
            value = identityState.address3,
            onValueChange = identityItemTypeHandlers.onAddress3TextChange,
            textFieldTestTag = "IdentityAddressThreeEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.city_town),
            value = identityState.city,
            onValueChange = identityItemTypeHandlers.onCityTextChange,
            textFieldTestTag = "IdentityCityEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.state_province),
            value = identityState.state,
            onValueChange = identityItemTypeHandlers.onStateTextChange,
            textFieldTestTag = "IdentityStateEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.zip_postal_code),
            value = identityState.zip,
            onValueChange = identityItemTypeHandlers.onZipTextChange,
            textFieldTestTag = "IdentityPostalCodeEntry",
            cardStyle = CardStyle.Middle(),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
    item {
        VowkeyTextField(
            label = stringResource(id = VowkeyString.country),
            value = identityState.country,
            onValueChange = identityItemTypeHandlers.onCountryTextChange,
            textFieldTestTag = "IdentityCountryEntry",
            cardStyle = CardStyle.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
}

@Composable
private fun TitleMultiSelectButton(
    selectedTitle: VaultIdentityTitle,
    onTitleSelected: (VaultIdentityTitle) -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    VowkeyMultiSelectButton(
        label = stringResource(id = VowkeyString.title),
        options = VaultIdentityTitle
            .entries
            .map { it.value() }
            .toImmutableList(),
        selectedOption = selectedTitle.value(),
        onOptionSelected = { selectedString ->
            onTitleSelected(
                VaultIdentityTitle
                    .entries
                    .first { it.value.toString(resources) == selectedString },
            )
        },
        cardStyle = CardStyle.Top(),
        modifier = modifier,
    )
}
