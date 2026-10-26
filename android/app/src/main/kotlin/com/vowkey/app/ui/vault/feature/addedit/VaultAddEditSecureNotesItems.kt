package com.vowkey.app.ui.vault.feature.addedit

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.addedit.handlers.VaultAddEditCommonHandlers

/**
 * The UI for adding and editing a secure notes cipher.
 */
fun LazyListScope.vaultAddEditSecureNotesItems(
    commonState: VaultAddEditState.ViewState.Content.Common,
    commonTypeHandlers: VaultAddEditCommonHandlers,
) {
    item {
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyTextField(
            singleLine = false,
            label = stringResource(id = VowkeyString.notes),
            value = commonState.notes,
            onValueChange = commonTypeHandlers.onNotesTextChange,
            textFieldTestTag = "ItemNotesEntry",
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
}
