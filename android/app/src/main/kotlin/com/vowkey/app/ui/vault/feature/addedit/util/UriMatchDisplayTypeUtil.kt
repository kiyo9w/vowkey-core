package com.vowkey.app.ui.vault.feature.addedit.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.vault.UriMatchType
import com.vowkey.app.ui.vault.feature.addedit.model.UriMatchDisplayType

/**
 * Method to convert the SDK match type for display to the user.
 */
fun UriMatchType?.toDisplayMatchType(): UriMatchDisplayType =
    when (this) {
        UriMatchType.DOMAIN -> UriMatchDisplayType.BASE_DOMAIN
        UriMatchType.EXACT -> UriMatchDisplayType.EXACT
        UriMatchType.HOST -> UriMatchDisplayType.HOST
        UriMatchType.NEVER -> UriMatchDisplayType.NEVER
        UriMatchType.REGULAR_EXPRESSION -> UriMatchDisplayType.REGULAR_EXPRESSION
        UriMatchType.STARTS_WITH -> UriMatchDisplayType.STARTS_WITH
        null -> UriMatchDisplayType.DEFAULT
    }

/**
 * Method to convert the match display type over to the SDK match type.
 */
fun UriMatchDisplayType.toUriMatchType(): UriMatchType? =
    when (this) {
        UriMatchDisplayType.DEFAULT -> null
        UriMatchDisplayType.BASE_DOMAIN -> UriMatchType.DOMAIN
        UriMatchDisplayType.HOST -> UriMatchType.HOST
        UriMatchDisplayType.STARTS_WITH -> UriMatchType.STARTS_WITH
        UriMatchDisplayType.REGULAR_EXPRESSION -> UriMatchType.REGULAR_EXPRESSION
        UriMatchDisplayType.EXACT -> UriMatchType.EXACT
        UriMatchDisplayType.NEVER -> UriMatchType.NEVER
    }

/**
 * Checks if the [UriMatchDisplayType] is considered an advanced matching strategy.
 */
fun UriMatchDisplayType.isAdvancedMatching(): Boolean =
    when (this) {
        UriMatchDisplayType.REGULAR_EXPRESSION,
        UriMatchDisplayType.STARTS_WITH,
            -> true

        else -> false
    }

/**
 * Returns a human-readable display label for the given [UriMatchType].
 */
fun UriMatchDisplayType.displayLabel(defaultUriOption: String): Text {
    return when (this) {
        UriMatchDisplayType.DEFAULT -> VowkeyString.default_text.asText(defaultUriOption)
        UriMatchDisplayType.BASE_DOMAIN -> VowkeyString.base_domain.asText()
        UriMatchDisplayType.HOST -> VowkeyString.host.asText()
        UriMatchDisplayType.STARTS_WITH -> VowkeyString.starts_with.asText()
        UriMatchDisplayType.REGULAR_EXPRESSION -> VowkeyString.reg_ex.asText()
        UriMatchDisplayType.EXACT -> VowkeyString.exact.asText()
        UriMatchDisplayType.NEVER -> VowkeyString.never.asText()
    }
}
