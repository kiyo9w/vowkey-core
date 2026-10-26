package com.vowkey.app.ui.platform.components.dialog

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
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
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled dialog for entering client certificate password and alias.
 *
 * @param onConfirmClick called when the confirm button is clicked and emits the input values.
 * @param onDismissRequest called when the user attempts to dismiss the dialog (for example by
 * tapping outside of it).
 */
@Suppress("LongMethod")
@Composable
fun VowkeyClientCertificateDialog(
    onConfirmClick: (alias: String, password: String) -> Unit,
    onDismissRequest: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var alias by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
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
                isEnabled = password.isNotEmpty(),
                onClick = { onConfirmClick(alias, password) },
                modifier = Modifier.testTag("AcceptAlertButton"),
            )
        },
        title = {
            Text(
                text = stringResource(VowkeyString.import_client_certificate),
                style = VowkeyTheme.typography.headlineSmall,
                modifier = Modifier.testTag("AlertTitleText"),
            )
        },
        text = {
            Column {
                Text(
                    text = stringResource(
                        VowkeyString.enter_the_client_certificate_password_and_alias,
                    ),
                    style = VowkeyTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("AlertContentText"),
                )

                Spacer(modifier = Modifier.height(24.dp))

                VowkeyTextField(
                    label = stringResource(VowkeyString.alias),
                    value = alias,
                    onValueChange = { alias = it },
                    autoFocus = true,
                    cardStyle = CardStyle.Top(dividerPadding = 0.dp),
                    textFieldTestTag = "AlertClientCertificateAliasInputField",
                    modifier = Modifier.fillMaxWidth(),
                )

                VowkeyPasswordField(
                    label = stringResource(VowkeyString.password),
                    value = password,
                    onValueChange = { password = it },
                    cardStyle = CardStyle.Bottom,
                    passwordFieldTestTag = "AlertClientCertificatePasswordInputField",
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        shape = VowkeyTheme.shapes.dialog,
        containerColor = VowkeyTheme.colorScheme.background.primary,
        iconContentColor = VowkeyTheme.colorScheme.icon.secondary,
        titleContentColor = VowkeyTheme.colorScheme.text.primary,
        textContentColor = VowkeyTheme.colorScheme.text.primary,
        modifier = modifier.semantics {
            testTagsAsResourceId = true
            testTag = "AlertPopup"
        },
    )
}

@Preview(showBackground = true)
@PreviewScreenSizes
@Composable
private fun VowkeyClientCertificateDialogPreview() {
    VowkeyTheme {
        VowkeyClientCertificateDialog(
            onConfirmClick = { alias, password -> },
            onDismissRequest = {},
        )
    }
}
