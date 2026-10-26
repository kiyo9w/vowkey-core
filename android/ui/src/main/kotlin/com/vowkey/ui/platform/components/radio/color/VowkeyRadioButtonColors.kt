package com.vowkey.ui.platform.components.radio.color

import androidx.compose.material3.RadioButtonColors
import androidx.compose.runtime.Composable
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for radio buttons.
 */
@Composable
fun vowkeyRadioButtonColors(): RadioButtonColors = RadioButtonColors(
    selectedColor = VowkeyTheme.colorScheme.filledButton.background,
    unselectedColor = VowkeyTheme.colorScheme.icon.primary,
    disabledSelectedColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledUnselectedColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)
