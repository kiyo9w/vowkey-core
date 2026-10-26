package com.vowkey.ui.platform.components.toggle.color

import androidx.compose.material3.SwitchColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for switches.
 */
@Composable
fun vowkeySwitchColors(): SwitchColors = SwitchColors(
    checkedThumbColor = VowkeyTheme.colorScheme.toggleButton.switch,
    checkedTrackColor = VowkeyTheme.colorScheme.toggleButton.backgroundOn,
    checkedBorderColor = Color.Transparent,
    checkedIconColor = VowkeyTheme.colorScheme.toggleButton.backgroundOn,
    uncheckedThumbColor = VowkeyTheme.colorScheme.toggleButton.switch,
    uncheckedTrackColor = VowkeyTheme.colorScheme.toggleButton.backgroundOff,
    uncheckedBorderColor = Color.Transparent,
    uncheckedIconColor = VowkeyTheme.colorScheme.toggleButton.backgroundOn,
    disabledCheckedThumbColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledCheckedTrackColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledCheckedBorderColor = Color.Transparent,
    disabledCheckedIconColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledUncheckedThumbColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledUncheckedTrackColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledUncheckedBorderColor = Color.Transparent,
    disabledUncheckedIconColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
)
