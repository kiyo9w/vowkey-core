package com.vowkey.ui.platform.components.segment.color

import androidx.compose.material3.SegmentedButtonColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for segmented buttons.
 */
@Composable
fun vowkeySegmentedButtonColors(): SegmentedButtonColors = SegmentedButtonColors(
    activeContainerColor = VowkeyTheme.colorScheme.filledButton.backgroundReversed,
    activeContentColor = VowkeyTheme.colorScheme.filledButton.foregroundReversed,
    activeBorderColor = Color.Transparent,
    inactiveContainerColor = VowkeyTheme.colorScheme.background.primary,
    inactiveContentColor = VowkeyTheme.colorScheme.text.secondary,
    inactiveBorderColor = Color.Transparent,
    disabledActiveContainerColor = VowkeyTheme.colorScheme.background.primary,
    disabledActiveContentColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledActiveBorderColor = Color.Transparent,
    disabledInactiveContainerColor = VowkeyTheme.colorScheme.background.primary,
    disabledInactiveContentColor = VowkeyTheme.colorScheme.stroke.divider,
    disabledInactiveBorderColor = Color.Transparent,
)
