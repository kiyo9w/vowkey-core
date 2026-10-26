package com.vowkey.ui.platform.components.dialog.model

import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.util.Text

/**
 * Contains the data for displaying a [VowkeyTwoButtonDialog].
 *
 * @property title The optional title to show.
 * @property message The message to show.
 * @property confirmButtonText The text to show on confirm button.
 * @property dismissButtonText The text to show on dismiss button.
 */
data class VowkeyTwoButtonDialogData(
    val title: Text?,
    val message: Text,
    val confirmButtonText: Text,
    val dismissButtonText: Text,
)
