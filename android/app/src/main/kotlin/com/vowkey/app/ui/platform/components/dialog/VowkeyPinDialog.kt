package com.vowkey.app.ui.platform.components.dialog

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.semantics.testTagsAsResourceId
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled dialog for the user to enter their PIN.
 *
 * @param onConfirmClick called when the confirm button is clicked and emits the entered PIN.
 * @param onDismissRequest called when the user attempts to dismiss the dialog (for example by
 * tapping outside of it).
 */
@Composable
fun VowkeyPinDialog(
    onConfirmClick: (pin: String) -> Unit,
    onDismissRequest: () -> Unit,
) {
    var pin by remember { mutableStateOf("") }
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
                label = stringResource(id = VowkeyString.submit),
                isEnabled = pin.isNotEmpty(),
                onClick = { onConfirmClick(pin) },
                modifier = Modifier.testTag("AcceptAlertButton"),
            )
        },
        title = {
            Text(
                text = stringResource(id = VowkeyString.verify_pin),
                style = VowkeyTheme.typography.headlineSmall,
                modifier = Modifier.testTag("AlertTitleText"),
            )
        },
        text = {
            VowkeyPasswordField(
                label = stringResource(id = VowkeyString.pin),
                value = pin,
                onValueChange = { pin = it },
                autoFocus = true,
                passwordFieldTestTag = "AlertInputField",
                cardStyle = CardStyle.Full,
                modifier = Modifier.fillMaxWidth(),
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
}
