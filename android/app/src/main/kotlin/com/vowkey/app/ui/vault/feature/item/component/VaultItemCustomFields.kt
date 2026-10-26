package com.vowkey.app.ui.vault.feature.item.component

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.item.VaultItemState.ViewState.Content.Common.Custom
import com.vowkey.app.ui.vault.feature.item.handlers.VaultCommonItemTypeHandlers
import kotlinx.collections.immutable.ImmutableList

/**
 * Displays the common custom field items for the vault item screen.
 *
 * @param customFields The custom fields to display.
 * @param vaultCommonItemTypeHandlers Provides the handlers required for each custom field.
 */
fun LazyListScope.vaultItemCustomFields(
    customFields: ImmutableList<Custom>,
    vaultCommonItemTypeHandlers: VaultCommonItemTypeHandlers,
) {
    if (customFields.isEmpty()) return
    item(key = "customFieldsHeader") {
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.custom_fields),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp)
                .animateItem(),
        )
    }
    itemsIndexed(
        items = customFields,
        key = { index, _ -> "customField_$index" },
    ) { _, customField ->
        Spacer(modifier = Modifier.height(height = 8.dp))
        CustomField(
            customField = customField,
            onCopyCustomHiddenField = vaultCommonItemTypeHandlers.onCopyCustomHiddenField,
            onCopyCustomTextField = vaultCommonItemTypeHandlers.onCopyCustomTextField,
            onShowHiddenFieldClick = vaultCommonItemTypeHandlers.onShowHiddenFieldClick,
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .animateItem(),
        )
    }
}
