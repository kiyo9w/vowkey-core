package com.vowkey.ui.platform.components.field.support

import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.divider.VowkeyHorizontalDivider
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.support.VowkeySupportingContent

/**
 * Lays out the Vowkey-styled supporting content for a text field.
 *
 * Intended to be reused for all implementations of a TextField, such as the [VowkeyTextField]
 * and [VowkeyPasswordField].
 */
@Composable
internal fun ColumnScope.VowkeyTextFieldSupportingContent(
    content: (@Composable ColumnScope.() -> Unit)?,
    supportingContentPadding: PaddingValues,
    noContentCardPadding: Dp,
) {
    if (content != null) {
        Spacer(modifier = Modifier.height(height = 6.dp))
        VowkeyHorizontalDivider(
            modifier = Modifier
                .fillMaxWidth()
                .padding(start = 16.dp),
        )
        VowkeySupportingContent(
            cardStyle = null,
            insets = supportingContentPadding,
            content = content,
        )
    } else {
        // Pad out the card when there is no content.
        Spacer(modifier = Modifier.height(height = noContentCardPadding))
    }
}
