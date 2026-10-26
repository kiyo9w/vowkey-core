package com.vowkey.ui.platform.components.row

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.tooling.preview.Preview
import com.vowkey.ui.platform.base.util.mirrorIfRtl
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a row of text that can be clicked on and contains an external link.
 * A confirmation dialog will always be displayed before [onConfirmClick] is invoked.
 *
 * @param text The label for the row as a [String].
 * @param onConfirmClick The callback when the confirm button of the dialog is clicked.
 * @param cardStyle Indicates the type of card style to be applied.
 * @param modifier The modifier to be applied to the layout.
 * @param description An optional description label to be displayed below the [text].
 * @param withDivider Indicates if a divider should be drawn on the bottom of the row, defaults
 * to `true`.
 * @param dialogTitle The title of the dialog displayed when the user clicks this item.
 * @param dialogMessage The message of the dialog displayed when the user clicks this item.
 * @param dialogConfirmButtonText The text on the confirm button of the dialog displayed when the
 * user clicks this item.
 * @param dialogDismissButtonText The text on the dismiss button of the dialog displayed when the
 * user clicks this item.
 */
@Composable
fun VowkeyExternalLinkRow(
    text: String,
    onConfirmClick: () -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
    description: AnnotatedString? = null,
    withDivider: Boolean = true,
    dialogTitle: String,
    dialogMessage: String,
    dialogConfirmButtonText: String = stringResource(id = VowkeyString.continue_text),
    dialogDismissButtonText: String = stringResource(id = VowkeyString.cancel),
) {
    var shouldShowDialog by rememberSaveable { mutableStateOf(false) }
    VowkeyTextRow(
        text = text,
        description = description,
        onClick = { shouldShowDialog = true },
        modifier = modifier,
        withDivider = withDivider,
        cardStyle = cardStyle,
    ) {
        Icon(
            modifier = Modifier.mirrorIfRtl(),
            painter = rememberVectorPainter(id = VowkeyDrawable.ic_external_link),
            contentDescription = stringResource(id = VowkeyString.external_link),
            tint = VowkeyTheme.colorScheme.icon.primary,
        )
    }

    if (shouldShowDialog) {
        VowkeyTwoButtonDialog(
            title = dialogTitle,
            message = dialogMessage,
            confirmButtonText = dialogConfirmButtonText,
            dismissButtonText = dialogDismissButtonText,
            onConfirmClick = {
                shouldShowDialog = false
                onConfirmClick()
            },
            onDismissClick = { shouldShowDialog = false },
            onDismissRequest = { shouldShowDialog = false },
        )
    }
}

@Preview
@Composable
private fun VowkeyExternalLinkRow_preview() {
    VowkeyTheme {
        VowkeyExternalLinkRow(
            text = "Linked Text",
            onConfirmClick = { },
            dialogTitle = "",
            dialogMessage = "",
            cardStyle = CardStyle.Full,
        )
    }
}
