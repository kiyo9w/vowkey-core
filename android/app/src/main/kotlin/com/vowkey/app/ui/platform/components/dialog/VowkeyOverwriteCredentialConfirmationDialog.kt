package com.vowkey.app.ui.platform.components.dialog

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * A reusable dialog for confirming whether the user wants to overwrite an existing credential.
 *
 * @param onConfirmClick A callback for when the overwrite confirmation button is clicked.
 * @param onDismissRequest A callback for when the dialog is requesting dismissal.
 */
@Suppress("MaxLineLength")
@Composable
fun VowkeyOverwriteCredentialConfirmationDialog(
    title: String,
    message: String,
    onConfirmClick: () -> Unit,
    onDismissRequest: () -> Unit,
) {
    VowkeyTwoButtonDialog(
        title = title,
        message = message,
        confirmButtonText = stringResource(id = VowkeyString.okay),
        dismissButtonText = stringResource(id = VowkeyString.cancel),
        onConfirmClick = onConfirmClick,
        onDismissClick = onDismissRequest,
        onDismissRequest = onDismissRequest,
    )
}
