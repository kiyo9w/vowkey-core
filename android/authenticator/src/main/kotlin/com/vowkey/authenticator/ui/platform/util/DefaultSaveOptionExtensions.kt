package com.vowkey.authenticator.ui.platform.util

import com.vowkey.authenticator.ui.platform.feature.settings.data.model.DefaultSaveOption
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Returns a human-readable display label for the given [DefaultSaveOption].
 */
val DefaultSaveOption.displayLabel: Text
    get() = when (this) {
        DefaultSaveOption.NONE -> VowkeyString.none.asText()
        DefaultSaveOption.LOCAL -> VowkeyString.save_here.asText()
        DefaultSaveOption.VOWKEY_APP -> VowkeyString.save_to_vowkey.asText()
    }
