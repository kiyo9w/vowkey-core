package com.vowkey.ui.platform.base.util

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.base.BaseComposeTest
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.theme.VowkeyTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ColorExtensionsTest : BaseComposeTest() {

    @Suppress("MaxLineLength")
    @Test
    fun `isLightOverlayRequired for a color with luminance below the light threshold should return true`() {
        assertTrue(Color.Blue.isLightOverlayRequired)
    }

    @Suppress("MaxLineLength")
    @Test
    fun `isLightOverlayRequired for a color with luminance above the light threshold should return false`() {
        assertFalse(Color.Yellow.isLightOverlayRequired)
    }

    @Test
    fun `toSafeOverlayColor for a dark color in light mode should use the surface color`() =
        setContent(theme = AppTheme.LIGHT) {
            assertEquals(
                VowkeyTheme.colorScheme.background.primary,
                Color.Blue.toSafeOverlayColor(),
            )
        }

    @Test
    fun `toSafeOverlayColor for a dark color in dark mode should use the onSurface color`() =
        setContent(theme = AppTheme.DARK) {
            assertEquals(
                VowkeyTheme.colorScheme.text.primary,
                Color.Blue.toSafeOverlayColor(),
            )
        }

    @Test
    fun `toSafeOverlayColor for a light color in light mode should use the onSurface color`() =
        setContent(theme = AppTheme.LIGHT) {
            assertEquals(
                VowkeyTheme.colorScheme.text.primary,
                Color.Yellow.toSafeOverlayColor(),
            )
        }

    @Test
    fun `toSafeOverlayColor for a light color in dark mode should use the surface color`() =
        setContent(theme = AppTheme.DARK) {
            assertEquals(
                VowkeyTheme.colorScheme.background.primary,
                Color.Yellow.toSafeOverlayColor(),
            )
        }

    fun setContent(
        theme: AppTheme = AppTheme.DEFAULT,
        test: @Composable () -> Unit,
    ) {
        setTestContent {
            VowkeyTheme(
                theme = theme,
                content = test,
            )
        }
    }
}
