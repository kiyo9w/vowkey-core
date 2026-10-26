package com.vowkey.authenticator.ui.platform.util

import com.vowkey.authenticator.ui.platform.feature.settings.data.model.DefaultSaveOption
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class DefaultSaveOptionExtensionsTest {

    @Test
    fun `displayLabel should map to correct labels`() {
        DefaultSaveOption.entries.forEach {
            val expected = when (it) {
                DefaultSaveOption.VOWKEY_APP -> VowkeyString.save_to_vowkey.asText()
                DefaultSaveOption.LOCAL -> VowkeyString.save_here.asText()
                DefaultSaveOption.NONE -> VowkeyString.none.asText()
            }
            assertEquals(
                expected,
                it.displayLabel,
            )
        }
    }
}
