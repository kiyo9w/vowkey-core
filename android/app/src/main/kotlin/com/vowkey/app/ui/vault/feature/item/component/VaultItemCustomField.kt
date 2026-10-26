package com.vowkey.app.ui.vault.feature.item.component

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.feature.item.VaultItemState

/**
 * Custom Field UI common for all item types.
 */
@Suppress("LongMethod")
@Composable
fun CustomField(
    customField: VaultItemState.ViewState.Content.Common.Custom,
    onCopyCustomHiddenField: (String) -> Unit,
    onCopyCustomTextField: (String) -> Unit,
    onShowHiddenFieldClick: (
        VaultItemState.ViewState.Content.Common.Custom.HiddenField,
        Boolean,
    ) -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    when (customField) {
        is VaultItemState.ViewState.Content.Common.Custom.BooleanField -> {
            VowkeySwitch(
                label = customField.name,
                isChecked = customField.value,
                readOnly = true,
                onCheckedChange = { },
                cardStyle = cardStyle,
                modifier = modifier.testTag("ViewCustomBooleanField"),
            )
        }

        is VaultItemState.ViewState.Content.Common.Custom.HiddenField -> {
            if (customField.isCopyable) {
                VowkeyPasswordField(
                    label = customField.name,
                    value = customField.value,
                    showPasswordChange = { onShowHiddenFieldClick(customField, it) },
                    showPassword = customField.isVisible,
                    onValueChange = { },
                    readOnly = true,
                    singleLine = false,
                    showPasswordTestTag = "CustomFieldShowPasswordButton",
                    passwordFieldTestTag = "CustomFieldValue",
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(id = VowkeyString.copy),
                            onClick = { onCopyCustomHiddenField(customField.value) },
                            modifier = Modifier.testTag("CustomFieldCopyValueButton"),
                        )
                    },
                    cardStyle = cardStyle,
                    modifier = modifier.testTag("ViewCustomHiddenField"),
                )
            } else {
                VowkeyPasswordField(
                    label = customField.name,
                    value = customField.value,
                    showPasswordChange = { onShowHiddenFieldClick(customField, it) },
                    showPassword = customField.isVisible,
                    onValueChange = { },
                    readOnly = true,
                    singleLine = false,
                    cardStyle = cardStyle,
                    modifier = modifier,
                )
            }
        }

        is VaultItemState.ViewState.Content.Common.Custom.LinkedField -> {
            VowkeyTextField(
                label = customField.name,
                value = customField.vaultLinkedFieldType.label.invoke(),
                leadingIconData = IconData.Local(
                    iconRes = VowkeyDrawable.ic_linked,
                    contentDescription = VowkeyString.field_type_linked.asText(),
                ),
                onValueChange = { },
                readOnly = true,
                singleLine = false,
                cardStyle = cardStyle,
                textFieldTestTag = "CustomFieldDropdown",
                modifier = modifier.testTag("ViewCustomLinkedField"),
            )
        }

        is VaultItemState.ViewState.Content.Common.Custom.TextField -> {
            VowkeyTextField(
                label = customField.name,
                value = customField.value,
                onValueChange = { },
                readOnly = true,
                singleLine = false,
                textFieldTestTag = "CustomFieldValue",
                actions = {
                    if (customField.isCopyable) {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(id = VowkeyString.copy),
                            onClick = { onCopyCustomTextField(customField.value) },
                            modifier = Modifier.testTag("CustomFieldCopyValueButton"),
                        )
                    }
                },
                cardStyle = cardStyle,
                modifier = modifier.testTag("ViewCustomTextField"),
            )
        }
    }
}
