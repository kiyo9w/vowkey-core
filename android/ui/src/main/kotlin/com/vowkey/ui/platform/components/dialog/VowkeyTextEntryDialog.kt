package com.vowkey.ui.platform.components.dialog

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled dialog that is used to enter text.
 *
 * @param title The optional title to show.
 * @param textFieldLabel Label for the text field.
 * @param onConfirmClick Called when the confirm button is clicked.
 * @param onDismissRequest Called when the user attempts to dismiss the dialog.
 * @param autoFocus When set to true, the view will request focus after the first recomposition.
 * @param initialText The text that will be visible at the start of text entry.
 */
@Composable
fun VowkeyTextEntryDialog(
    title: String?,
    textFieldLabel: String,
    onConfirmClick: (String) -> Unit,
    onDismissRequest: () -> Unit,
    autoFocus: Boolean = false,
    initialText: String? = null,
) {
    var text by remember { mutableStateOf(initialText.orEmpty()) }
    val focusRequester = remember { FocusRequester() }
    var shouldRequestFocus by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismissRequest,
        dismissButton = {
            VowkeyTextButton(
                label = stringResource(id = VowkeyString.cancel),
                onClick = onDismissRequest,
                modifier = Modifier.testTag("DismissAlertButton"),
            )
        },
        confirmButton = {
            VowkeyTextButton(
                label = stringResource(id = VowkeyString.okay),
                onClick = { onConfirmClick(text) },
                isEnabled = text.isNotBlank(),
                modifier = Modifier.testTag("AcceptAlertButton"),
            )
        },
        title = title?.let {
            {
                Text(
                    text = it,
                    style = VowkeyTheme.typography.headlineSmall,
                    modifier = Modifier.testTag("AlertTitleText"),
                )
            }
        },
        text = {
            VowkeyTextField(
                label = textFieldLabel,
                value = text,
                onValueChange = { text = it },
                textFieldTestTag = "AlertContentText",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .focusRequester(focusRequester)
                    .onGloballyPositioned { shouldRequestFocus = true }
                    .fillMaxWidth(),
            )
        },
        shape = VowkeyTheme.shapes.dialog,
        containerColor = VowkeyTheme.colorScheme.background.primary,
        iconContentColor = VowkeyTheme.colorScheme.icon.secondary,
        titleContentColor = VowkeyTheme.colorScheme.text.primary,
        textContentColor = VowkeyTheme.colorScheme.text.primary,
        modifier = Modifier.semantics {
            testTagsAsResourceId = true
            testTag = "AlertPopup"
        },
    )

    if (autoFocus && shouldRequestFocus) {
        LaunchedEffect(Unit) {
            focusRequester.requestFocus()
        }
    }
}
