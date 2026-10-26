package com.vowkey.ui.platform.components.button.color

import androidx.compose.material3.IconButtonColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for a filled icon button.
 */
@Composable
fun vowkeyFilledIconButtonColors(): IconButtonColors = IconButtonColors(
    containerColor = VowkeyTheme.colorScheme.filledButton.background,
    contentColor = VowkeyTheme.colorScheme.filledButton.foreground,
    disabledContainerColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledContentColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)

/**
 * Provides a default set of Vowkey-styled colors for a standard icon button.
 */
@Composable
fun vowkeyStandardIconButtonColors(
    contentColor: Color = VowkeyTheme.colorScheme.icon.primary,
): IconButtonColors = IconButtonColors(
    containerColor = Color.Transparent,
    contentColor = contentColor,
    disabledContainerColor = Color.Transparent,
    disabledContentColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)

/**
 * Provides a default set of Vowkey-styled colors for a filled icon button.
 */
@Composable
fun vowkeyTonalIconButtonColors(): IconButtonColors = IconButtonColors(
    containerColor = VowkeyTheme.colorScheme.background.tertiary,
    contentColor = VowkeyTheme.colorScheme.filledButton.foregroundReversed,
    disabledContainerColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledContentColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)
