package com.vowkey.app.ui.platform.feature.settings.autofill.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.repository.model.UriMatchType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class UriMatchTypeExtensionsTest {
    @Test
    fun `displayLabel should return the correct value for each type`() {
        mapOf(
            UriMatchType.DOMAIN to VowkeyString.base_domain.asText(),
            UriMatchType.HOST to VowkeyString.host.asText(),
            UriMatchType.STARTS_WITH to VowkeyString.starts_with.asText(),
            UriMatchType.REGULAR_EXPRESSION to VowkeyString.reg_ex.asText(),
            UriMatchType.EXACT to VowkeyString.exact.asText(),
            UriMatchType.NEVER to VowkeyString.never.asText(),
        )
            .forEach { (type, label) ->
                assertEquals(
                    label,
                    type.displayLabel,
                )
            }
    }

    @Test
    fun `toSdkUriMatchType should return the correct value for each type`() {
        assertEquals(
            com.vowkey.vault.UriMatchType.DOMAIN,
            UriMatchType.DOMAIN.toSdkUriMatchType(),
        )
        assertEquals(
            com.vowkey.vault.UriMatchType.EXACT,
            UriMatchType.EXACT.toSdkUriMatchType(),
        )
        assertEquals(
            com.vowkey.vault.UriMatchType.HOST,
            UriMatchType.HOST.toSdkUriMatchType(),
        )
        assertEquals(
            com.vowkey.vault.UriMatchType.NEVER,
            UriMatchType.NEVER.toSdkUriMatchType(),
        )
        assertEquals(
            com.vowkey.vault.UriMatchType.REGULAR_EXPRESSION,
            UriMatchType.REGULAR_EXPRESSION.toSdkUriMatchType(),
        )
        assertEquals(
            com.vowkey.vault.UriMatchType.STARTS_WITH,
            UriMatchType.STARTS_WITH.toSdkUriMatchType(),
        )
    }

    @Test
    fun `isAdvancedMatching should return the correct value for each type`() {
        assertEquals(
            false,
            UriMatchType.DOMAIN.isAdvancedMatching(),
        )
        assertEquals(
            false,
            UriMatchType.EXACT.isAdvancedMatching(),
        )
        assertEquals(
            false,
            UriMatchType.HOST.isAdvancedMatching(),
        )
        assertEquals(
            false,
            UriMatchType.NEVER.isAdvancedMatching(),
        )
        assertEquals(
            true,
            UriMatchType.REGULAR_EXPRESSION.isAdvancedMatching(),
        )
        assertEquals(
            true,
            UriMatchType.STARTS_WITH.isAdvancedMatching(),
        )
    }
}
