package com.vowkey.ui.platform.theme

import android.content.Context
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.ui.platform.LocalContext
import com.vowkey.core.util.isBuildVersionAtLeast
import com.vowkey.ui.platform.components.field.interceptor.IncognitoInput
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.theme.color.VowkeyColorScheme
import com.vowkey.ui.platform.theme.color.darkVowkeyColorScheme
import com.vowkey.ui.platform.theme.color.dynamicVowkeyColorScheme
import com.vowkey.ui.platform.theme.color.lightVowkeyColorScheme
import com.vowkey.ui.platform.theme.color.toMaterialColorScheme
import com.vowkey.ui.platform.theme.ripple.toRippleConfig
import com.vowkey.ui.platform.theme.shape.VowkeyShapes
import com.vowkey.ui.platform.theme.shape.vowkeyShapes
import com.vowkey.ui.platform.theme.type.VowkeyTypography
import com.vowkey.ui.platform.theme.type.vowkeyTypography
import com.vowkey.ui.platform.theme.type.toMaterialTypography
import com.vowkey.ui.platform.util.isDarkMode

/**
 * Static wrapper to make accessing the theme components easier.
 */
object VowkeyTheme {
    /**
     * Retrieves the current [VowkeyColorScheme].
     */
    val colorScheme: VowkeyColorScheme
        @Composable
        @ReadOnlyComposable
        get() = LocalVowkeyColorScheme.current

    /**
     * Retrieves the current [VowkeyShapes].
     */
    val shapes: VowkeyShapes
        @Composable
        @ReadOnlyComposable
        get() = LocalVowkeyShapes.current

    /**
     * Retrieves the current [VowkeyTypography].
     */
    val typography: VowkeyTypography
        @Composable
        @ReadOnlyComposable
        get() = LocalVowkeyTypography.current
}

/**
 * The overall application theme. This can be configured to support a [theme] and [dynamicColor].
 */
@Composable
fun VowkeyTheme(
    context: Context = LocalContext.current,
    theme: AppTheme = AppTheme.DEFAULT,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val isDarkTheme = theme.isDarkMode(isSystemDarkMode = isSystemInDarkTheme())
    val isDynamicEnabled = dynamicColor && isBuildVersionAtLeast(version = Build.VERSION_CODES.S)
    // Get the material color schemes from the OS.
    val darkMaterialColorScheme = if (isDynamicEnabled) {
        dynamicDarkColorScheme(context = context)
    } else {
        darkColorScheme()
    }
    val lightMaterialColorScheme = if (isDynamicEnabled) {
        dynamicLightColorScheme(context = context)
    } else {
        lightColorScheme()
    }
    val materialColorScheme = if (isDarkTheme) darkMaterialColorScheme else lightMaterialColorScheme
    // Convert the material color schemes to Vowkey color schemes.
    val lightDynamicColorScheme = dynamicVowkeyColorScheme(
        materialColorScheme = lightMaterialColorScheme,
        isDarkTheme = false,
    )
    val darkDynamicColorScheme = dynamicVowkeyColorScheme(
        materialColorScheme = darkMaterialColorScheme,
        isDarkTheme = true,
    )
    val vowkeyColorScheme = when {
        isDynamicEnabled -> if (isDarkTheme) darkDynamicColorScheme else lightDynamicColorScheme
        isDarkTheme -> darkVowkeyColorScheme
        else -> lightVowkeyColorScheme
    }
    // Provide the selected color scheme as well as the dynamic ones for override support.
    CompositionLocalProvider(
        LocalVowkeyColorScheme provides vowkeyColorScheme,
        LocalVowkeyDynamicLightColorScheme provides lightDynamicColorScheme,
        LocalVowkeyDynamicDarkColorScheme provides darkDynamicColorScheme,
        LocalVowkeyShapes provides vowkeyShapes,
        LocalVowkeyTypography provides vowkeyTypography,
        LocalRippleConfiguration provides vowkeyColorScheme.toRippleConfig(),
    ) {
        MaterialTheme(
            colorScheme = vowkeyColorScheme.toMaterialColorScheme(
                defaultColorScheme = materialColorScheme,
            ),
            typography = vowkeyTypography.toMaterialTypography(),
        ) { IncognitoInput(content = content) }
    }
}

/**
 * Provides access to the Vowkey colors throughout the app.
 */
val LocalVowkeyColorScheme: ProvidableCompositionLocal<VowkeyColorScheme> =
    compositionLocalOf { lightVowkeyColorScheme }

/**
 * Provides access to the Vowkey dynamic light-mode colors throughout the app.
 * This is only to be used for scenarios that require the UI to have its colors overridden.
 */
val LocalVowkeyDynamicLightColorScheme: ProvidableCompositionLocal<VowkeyColorScheme> =
    compositionLocalOf { lightVowkeyColorScheme }

/**
 * Provides access to the Vowkey default dark-mode colors throughout the app.
 * This is only to be used for dynamic that require the UI to have its colors overridden.
 */
val LocalVowkeyDynamicDarkColorScheme: ProvidableCompositionLocal<VowkeyColorScheme> =
    compositionLocalOf { darkVowkeyColorScheme }

/**
 * Provides access to the Vowkey shapes throughout the app.
 */
val LocalVowkeyShapes: ProvidableCompositionLocal<VowkeyShapes> =
    compositionLocalOf { vowkeyShapes }

/**
 * Provides access to the Vowkey typography throughout the app.
 */
val LocalVowkeyTypography: ProvidableCompositionLocal<VowkeyTypography> =
    compositionLocalOf { vowkeyTypography }
