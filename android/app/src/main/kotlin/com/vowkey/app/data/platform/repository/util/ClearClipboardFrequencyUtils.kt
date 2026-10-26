package com.vowkey.app.data.platform.repository.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.repository.model.ClearClipboardFrequency

/**
 * Provides a human-readable display label for the given [ClearClipboardFrequency].
 */
val ClearClipboardFrequency.displayLabel: Text
    get() = when (this) {
        ClearClipboardFrequency.NEVER -> VowkeyString.never
        ClearClipboardFrequency.TEN_SECONDS -> VowkeyString.ten_seconds
        ClearClipboardFrequency.TWENTY_SECONDS -> VowkeyString.twenty_seconds
        ClearClipboardFrequency.THIRTY_SECONDS -> VowkeyString.thirty_seconds
        ClearClipboardFrequency.ONE_MINUTE -> VowkeyString.one_minute
        ClearClipboardFrequency.TWO_MINUTES -> VowkeyString.two_minutes
        ClearClipboardFrequency.FIVE_MINUTES -> VowkeyString.five_minutes
    }
        .asText()
