package com.vowkey.ui.platform.util

import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Returns a human-readable display label for the given [AppTheme].
 */
val AppTheme.displayLabel: Text
    get() = when (this) {
        AppTheme.DEFAULT -> VowkeyString.default_system.asText()
        AppTheme.DARK -> VowkeyString.dark.asText()
        AppTheme.LIGHT -> VowkeyString.light.asText()
    }

/**
 * Returns `true` if the app is currently using dark mode.
 */
fun AppTheme.isDarkMode(
    isSystemDarkMode: Boolean,
): Boolean =
    when (this) {
        AppTheme.DEFAULT -> isSystemDarkMode
        AppTheme.DARK -> true
        AppTheme.LIGHT -> false
    }
