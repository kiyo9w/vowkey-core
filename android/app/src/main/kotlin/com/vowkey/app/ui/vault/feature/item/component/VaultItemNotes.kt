package com.vowkey.app.ui.vault.feature.item.component

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.item.handlers.VaultCommonItemTypeHandlers

/**
 * Displays the common notes field for the vault item screen.
 *
 * @param notes The notes.
 * @param vaultCommonItemTypeHandlers Provides the handlers required for the notes.
 * @param showHeader Indicates whether to show the header.
 */
fun LazyListScope.vaultItemNotes(
    notes: String?,
    vaultCommonItemTypeHandlers: VaultCommonItemTypeHandlers,
    showHeader: Boolean = true,
) {
    notes ?: return
    item(key = "notes") {
        if (showHeader) {
            Spacer(modifier = Modifier.height(height = 16.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.additional_options),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp)
                    .animateItem(),
            )
        }
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyTextField(
            label = stringResource(id = VowkeyString.notes),
            value = notes,
            onValueChange = { },
            readOnly = true,
            singleLine = false,
            actions = {
                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_copy,
                    contentDescription = stringResource(id = VowkeyString.copy_notes),
                    onClick = vaultCommonItemTypeHandlers.onCopyNotesClick,
                    modifier = Modifier.testTag(tag = "CipherNotesCopyButton"),
                )
            },
            textFieldTestTag = "CipherNotesLabel",
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .animateItem(),
        )
    }
}
