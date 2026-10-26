package com.vowkey.ui.platform.util

import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class AppThemeExtensionsTest {
    @Test
    fun `displayLabel should return the correct value for each type`() {
        mapOf(
            AppTheme.DEFAULT to VowkeyString.default_system.asText(),
            AppTheme.DARK to VowkeyString.dark.asText(),
            AppTheme.LIGHT to VowkeyString.light.asText(),
        )
            .forEach { (type, label) ->
                assertEquals(
                    label,
                    type.displayLabel,
                )
            }
    }
}
