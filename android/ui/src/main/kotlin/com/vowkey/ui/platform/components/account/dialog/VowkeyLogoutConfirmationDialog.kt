package com.vowkey.ui.platform.components.account.dialog

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.vowkey.ui.platform.components.account.model.AccountSummary
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * A reusable dialog for confirming whether the user wants to log out.
 *
 * @param onDismissRequest A callback for when the dialog is requesting dismissal.
 * @param onConfirmClick A callback for when the log out confirmation button is clicked.
 * @param accountSummary Optional account information that may be used to provide additional
 * information.
 */
@Composable
fun VowkeyLogoutConfirmationDialog(
    onDismissRequest: () -> Unit,
    onConfirmClick: () -> Unit,
    accountSummary: AccountSummary? = null,
) {
    val baseConfirmationMessage = stringResource(id = VowkeyString.logout_confirmation)
    val message = accountSummary
        ?.let { "$baseConfirmationMessage\n\n${it.email}\n${it.environmentLabel}" }
        ?: baseConfirmationMessage
    VowkeyTwoButtonDialog(
        title = stringResource(id = VowkeyString.log_out),
        message = message,
        confirmButtonText = stringResource(id = VowkeyString.yes),
        onConfirmClick = onConfirmClick,
        dismissButtonText = stringResource(id = VowkeyString.cancel),
        onDismissClick = onDismissRequest,
        onDismissRequest = onDismissRequest,
    )
}
