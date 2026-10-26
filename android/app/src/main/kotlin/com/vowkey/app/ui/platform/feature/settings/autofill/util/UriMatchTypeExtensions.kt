package com.vowkey.app.ui.platform.feature.settings.autofill.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.repository.model.UriMatchType

/**
 * Returns a human-readable display label for the given [UriMatchType].
 */
val UriMatchType.displayLabel: Text
    get() = when (this) {
        UriMatchType.DOMAIN -> VowkeyString.base_domain
        UriMatchType.HOST -> VowkeyString.host
        UriMatchType.STARTS_WITH -> VowkeyString.starts_with
        UriMatchType.REGULAR_EXPRESSION -> VowkeyString.reg_ex
        UriMatchType.EXACT -> VowkeyString.exact
        UriMatchType.NEVER -> VowkeyString.never
    }
        .asText()

/**
 * Convert this internal [UriMatchType] to the sdk model.
 */
fun UriMatchType.toSdkUriMatchType(): com.vowkey.vault.UriMatchType =
    when (this) {
        UriMatchType.DOMAIN -> com.vowkey.vault.UriMatchType.DOMAIN
        UriMatchType.EXACT -> com.vowkey.vault.UriMatchType.EXACT
        UriMatchType.HOST -> com.vowkey.vault.UriMatchType.HOST
        UriMatchType.NEVER -> com.vowkey.vault.UriMatchType.NEVER
        UriMatchType.REGULAR_EXPRESSION -> com.vowkey.vault.UriMatchType.REGULAR_EXPRESSION
        UriMatchType.STARTS_WITH -> com.vowkey.vault.UriMatchType.STARTS_WITH
    }

/**
 * Checks if the [UriMatchType] is considered an advanced matching strategy.
 */
fun UriMatchType.isAdvancedMatching(): Boolean =
    when (this) {
        UriMatchType.REGULAR_EXPRESSION,
        UriMatchType.STARTS_WITH,
            -> true

        else -> false
    }
