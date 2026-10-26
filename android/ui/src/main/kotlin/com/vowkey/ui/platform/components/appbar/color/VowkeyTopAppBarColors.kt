package com.vowkey.ui.platform.components.appbar.color

import androidx.compose.material3.TopAppBarColors
import androidx.compose.runtime.Composable
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for top app bars.
 */
@Composable
fun vowkeyTopAppBarColors(): TopAppBarColors = TopAppBarColors(
    containerColor = VowkeyTheme.colorScheme.background.secondary,
    scrolledContainerColor = VowkeyTheme.colorScheme.background.secondary,
    navigationIconContentColor = VowkeyTheme.colorScheme.icon.primary,
    titleContentColor = VowkeyTheme.colorScheme.text.primary,
    actionIconContentColor = VowkeyTheme.colorScheme.icon.primary,
    subtitleContentColor = VowkeyTheme.colorScheme.text.primary,
)
