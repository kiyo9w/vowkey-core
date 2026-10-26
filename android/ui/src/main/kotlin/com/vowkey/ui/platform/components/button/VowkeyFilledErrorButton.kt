package com.vowkey.ui.platform.components.button

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.tooling.preview.Preview
import com.vowkey.ui.platform.components.button.color.vowkeyFilledErrorButtonColors
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable

/**
 * Represents a Vowkey-styled filled [Button] for error scenarios.
 *
 * @param label The label for the button.
 * @param onClick The callback when the button is clicked.
 * @param modifier The [Modifier] to be applied to the button.
 * @param icon The icon for the button.
 * @param isEnabled Whether the button is enabled.
 */
@Composable
fun VowkeyFilledErrorButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: Painter? = null,
    isEnabled: Boolean = true,
) {
    VowkeyFilledButton(
        label = label,
        onClick = onClick,
        icon = icon,
        modifier = modifier,
        isEnabled = isEnabled,
        colors = vowkeyFilledErrorButtonColors(),
    )
}

@Preview
@Composable
private fun VowkeyErrorButton_preview() {
    Column {
        VowkeyFilledErrorButton(
            label = "Label",
            onClick = {},
            icon = null,
            isEnabled = true,
        )
        VowkeyFilledErrorButton(
            label = "Label",
            onClick = {},
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_question_circle),
            isEnabled = true,
        )
        VowkeyFilledErrorButton(
            label = "Label",
            onClick = {},
            icon = null,
            isEnabled = false,
        )
        VowkeyFilledErrorButton(
            label = "Label",
            onClick = {},
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_question_circle),
            isEnabled = false,
        )
    }
}
