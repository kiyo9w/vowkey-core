package com.vowkey.ui.platform.components.radio

import androidx.compose.material3.RadioButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.vowkey.ui.platform.components.radio.color.vowkeyRadioButtonColors

/**
 * A custom Vowkey-themed radio button.
 *
 * @param isSelected Whether this radio button is selected or not.
 * @param onClick The lambda to be invoked when the item is clicked.
 * @param modifier The [Modifier] to be applied to this radio button.
 */
@Composable
fun VowkeyRadioButton(
    isSelected: Boolean,
    onClick: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    RadioButton(
        modifier = modifier,
        selected = isSelected,
        onClick = onClick,
        colors = vowkeyRadioButtonColors(),
    )
}
