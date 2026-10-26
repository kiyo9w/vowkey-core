package com.vowkey.ui.platform.components.appbar.color

import androidx.compose.material3.MenuItemColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for menu items.
 */
@Composable
fun vowkeyMenuItemColors(
    textColor: Color = VowkeyTheme.colorScheme.text.primary,
): MenuItemColors = MenuItemColors(
    textColor = textColor,
    leadingIconColor = VowkeyTheme.colorScheme.icon.primary,
    trailingIconColor = VowkeyTheme.colorScheme.icon.primary,
    disabledTextColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledLeadingIconColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledTrailingIconColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)
