package com.vowkey.ui.platform.components.navigation.color

import androidx.compose.material3.NavigationRailItemColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for navigation rail items.
 */
@Composable
fun vowkeyNavigationRailItemColors(): NavigationRailItemColors = NavigationRailItemColors(
    selectedIconColor = VowkeyTheme.colorScheme.icon.secondary,
    unselectedIconColor = VowkeyTheme.colorScheme.icon.primary,
    disabledIconColor = VowkeyTheme.colorScheme.outlineButton.foregroundDisabled,
    selectedTextColor = VowkeyTheme.colorScheme.icon.secondary,
    unselectedTextColor = VowkeyTheme.colorScheme.icon.primary,
    disabledTextColor = VowkeyTheme.colorScheme.outlineButton.foregroundDisabled,
    selectedIndicatorColor = Color.Transparent,
)
