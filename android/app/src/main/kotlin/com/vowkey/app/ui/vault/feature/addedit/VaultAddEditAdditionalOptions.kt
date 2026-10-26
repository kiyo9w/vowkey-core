package com.vowkey.app.ui.vault.feature.addedit

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.core.util.persistentListOfNotNull
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.model.VowkeyHelpButtonData
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyExpandingHeader
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.addedit.handlers.VaultAddEditCommonHandlers
import com.vowkey.app.ui.vault.feature.addedit.model.CustomFieldType

/**
 * The collapsable UI for additional options when adding or editing a cipher.
 */
@Suppress("LongMethod")
fun LazyListScope.vaultAddEditAdditionalOptions(
    itemType: VaultAddEditState.ViewState.Content.ItemType,
    commonState: VaultAddEditState.ViewState.Content.Common,
    commonTypeHandlers: VaultAddEditCommonHandlers,
    isAdditionalOptionsExpanded: Boolean,
    onAdditionalOptionsClick: () -> Unit,
) {
    item {
        VowkeyExpandingHeader(
            isExpanded = isAdditionalOptionsExpanded,
            onClick = onAdditionalOptionsClick,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
    }

    if (isAdditionalOptionsExpanded) {
        val isNotes = itemType is VaultAddEditState.ViewState.Content.ItemType.SecureNotes
        if (!isNotes) {
            item(key = "optionalNotes") {
                VowkeyTextField(
                    singleLine = false,
                    label = stringResource(id = VowkeyString.notes),
                    value = commonState.notes,
                    onValueChange = commonTypeHandlers.onNotesTextChange,
                    textFieldTestTag = "ItemNotesEntry",
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .animateItem()
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }
        }

        if (commonState.isUnlockWithPasswordEnabled) {
            item(key = "MasterPasswordRepromptToggle") {
                Column(
                    modifier = Modifier
                        .animateItem()
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                ) {
                    if (!isNotes) {
                        Spacer(modifier = Modifier.height(height = 8.dp))
                    }
                    VowkeySwitch(
                        label = stringResource(id = VowkeyString.password_prompt),
                        isChecked = commonState.masterPasswordReprompt,
                        onCheckedChange = commonTypeHandlers.onToggleMasterPasswordReprompt,
                        helpData = VowkeyHelpButtonData(
                            onClick = commonTypeHandlers.onTooltipClick,
                            contentDescription = stringResource(
                                id = VowkeyString.master_password_re_prompt_help,
                            ),
                            isExternalLink = true,
                        ),
                        cardStyle = CardStyle.Full,
                        modifier = Modifier
                            .testTag(tag = "MasterPasswordRepromptToggle")
                            .fillMaxWidth(),
                    )
                }
            }
        }

        item(key = "customFieldsHeader") {
            Column(
                modifier = Modifier
                    .animateItem()
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            ) {
                Spacer(modifier = Modifier.height(height = 16.dp))
                VowkeyListHeaderText(
                    label = stringResource(id = VowkeyString.custom_fields),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp),
                )
            }
        }

        itemsIndexed(
            items = commonState.customFieldData,
            key = { _, customItem -> "customField_${customItem.itemId}" },
        ) { index, customItem ->
            Column(
                modifier = Modifier
                    .animateItem()
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            ) {
                Spacer(modifier = Modifier.height(height = 8.dp))
                VaultAddEditCustomField(
                    customField = customItem,
                    onCustomFieldValueChange = commonTypeHandlers.onCustomFieldValueChange,
                    onCustomFieldAction = commonTypeHandlers.onCustomFieldActionSelect,
                    showMoveUpAction = index > 0,
                    showMoveDownAction = index < commonState.customFieldData.lastIndex,
                    onHiddenVisibilityChanged = commonTypeHandlers.onHiddenFieldVisibilityChange,
                    supportedLinkedTypes = itemType.vaultLinkedFieldTypes,
                    cardStyle = CardStyle.Full,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        item(key = "addCustomFieldButton") {
            Column(
                modifier = Modifier
                    .animateItem()
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            ) {
                Spacer(modifier = Modifier.height(height = 8.dp))
                VaultAddEditCustomFieldsButton(
                    onFinishNamingClick = commonTypeHandlers.onAddNewCustomFieldClick,
                    options = persistentListOfNotNull(
                        CustomFieldType.TEXT,
                        CustomFieldType.HIDDEN,
                        CustomFieldType.BOOLEAN,
                        CustomFieldType.LINKED.takeIf {
                            itemType.vaultLinkedFieldTypes.isNotEmpty()
                        },
                    ),
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
