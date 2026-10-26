package com.vowkey.ui.platform.components.button

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.OutlinedButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.tooling.preview.Preview
import com.vowkey.ui.platform.components.button.color.vowkeyOutlinedButtonColors
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled filled [OutlinedButton] for error states.
 *
 * @param label The label for the button.
 * @param onClick The callback when the button is clicked.
 * @param modifier The [Modifier] to be applied to the button.
 * @param icon The icon for the button.
 * @param isEnabled Whether the button is enabled.
 */
@Composable
fun VowkeyOutlinedErrorButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: Painter? = null,
    isEnabled: Boolean = true,
) {
    VowkeyOutlinedButton(
        label = label,
        onClick = onClick,
        icon = icon,
        modifier = modifier,
        isEnabled = isEnabled,
        colors = vowkeyOutlinedButtonColors(
            contentColor = VowkeyTheme.colorScheme.status.error,
            outlineColor = VowkeyTheme.colorScheme.status.error,
            outlineColorDisabled = VowkeyTheme.colorScheme.status.error.copy(alpha = 0.12f),
        ),
    )
}

@Preview
@Composable
private fun BVowkeyOutlinedErrorButton_preview() {
    Column {
        VowkeyOutlinedErrorButton(
            label = "Label",
            onClick = {},
            icon = null,
            isEnabled = true,
        )
        VowkeyOutlinedErrorButton(
            label = "Label",
            onClick = {},
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_question_circle),
            isEnabled = true,
        )
        VowkeyOutlinedErrorButton(
            label = "Label",
            onClick = {},
            icon = null,
            isEnabled = false,
        )
        VowkeyOutlinedErrorButton(
            label = "Label",
            onClick = {},
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_question_circle),
            isEnabled = false,
        )
    }
}
