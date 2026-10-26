package com.vowkey.ui.platform.base.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.platform.theme.LocalVowkeyColorScheme
import com.vowkey.ui.platform.theme.LocalVowkeyDynamicDarkColorScheme
import com.vowkey.ui.platform.theme.LocalVowkeyDynamicLightColorScheme
import com.vowkey.ui.platform.theme.color.VowkeyColorScheme
import com.vowkey.ui.platform.theme.color.darkVowkeyColorScheme
import com.vowkey.ui.platform.theme.color.lightVowkeyColorScheme

/**
 * Overrides the [VowkeyColorScheme] for the [content] based on the provided [AppTheme].
 */
@Composable
fun ColorSchemeOverride(
    appTheme: AppTheme,
    content: @Composable () -> Unit,
) {
    val colorSchemeOverride = when (appTheme) {
        AppTheme.DEFAULT -> VowkeyTheme.colorScheme
        AppTheme.DARK -> {
            if (VowkeyTheme.colorScheme.isDynamicTheme) {
                LocalVowkeyDynamicDarkColorScheme.current
            } else {
                darkVowkeyColorScheme
            }
        }

        AppTheme.LIGHT -> {
            if (VowkeyTheme.colorScheme.isDynamicTheme) {
                LocalVowkeyDynamicLightColorScheme.current
            } else {
                lightVowkeyColorScheme
            }
        }
    }
    CompositionLocalProvider(
        value = LocalVowkeyColorScheme provides colorSchemeOverride,
        content = content,
    )
}
