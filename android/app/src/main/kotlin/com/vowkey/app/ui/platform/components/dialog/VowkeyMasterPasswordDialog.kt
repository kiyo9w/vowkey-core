package com.vowkey.app.ui.platform.components.dialog

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.text.KeyboardActions
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
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled dialog for entering your master password.
 *
 * @param title The title of the dialog.
 * @param message The message of the dialog.
 * @param confirmButtonText The text of the confirm button.
 * @param dismissButtonText The text of the dismiss button.
 * @param onConfirmClick called when the confirm button is clicked and emits the entered password.
 * @param onDismissRequest called when the user attempts to dismiss the dialog (for example by
 * tapping outside of it).
 */
@Composable
fun VowkeyMasterPasswordDialog(
    title: String = stringResource(id = VowkeyString.password_confirmation),
    message: String = stringResource(id = VowkeyString.password_confirmation_desc),
    confirmButtonText: String = stringResource(id = VowkeyString.submit),
    dismissButtonText: String = stringResource(id = VowkeyString.cancel),
    onConfirmClick: (masterPassword: String) -> Unit,
    onDismissRequest: () -> Unit,
) {
    var masterPassword by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismissRequest,
        dismissButton = {
            VowkeyTextButton(
                label = dismissButtonText,
                onClick = onDismissRequest,
                modifier = Modifier.testTag("DismissAlertButton"),
            )
        },
        confirmButton = {
            VowkeyFilledButton(
                label = confirmButtonText,
                isEnabled = masterPassword.isNotEmpty(),
                onClick = { onConfirmClick(masterPassword) },
                modifier = Modifier.testTag("AcceptAlertButton"),
            )
        },
        title = {
            Text(
                text = title,
                style = VowkeyTheme.typography.headlineSmall,
                modifier = Modifier.testTag("AlertTitleText"),
            )
        },
        text = {
            Column {
                Text(
                    text = message,
                    style = VowkeyTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("AlertContentText"),
                )

                Spacer(modifier = Modifier.height(8.dp))

                VowkeyPasswordField(
                    label = stringResource(id = VowkeyString.master_password),
                    value = masterPassword,
                    onValueChange = { masterPassword = it },
                    keyboardActions = KeyboardActions(
                        onDone = { onConfirmClick(masterPassword) },
                    ),
                    autoFocus = true,
                    passwordFieldTestTag = "AlertInputField",
                    cardStyle = CardStyle.Full,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
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
