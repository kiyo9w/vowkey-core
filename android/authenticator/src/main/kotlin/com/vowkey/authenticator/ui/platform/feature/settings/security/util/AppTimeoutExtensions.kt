package com.vowkey.authenticator.ui.platform.feature.settings.security.util

import com.vowkey.authenticator.data.platform.manager.lock.model.AppTimeout
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Provides a human-readable display label for the given [AppTimeout.Type].
 */
val AppTimeout.Type.displayLabel: Text
    get() = when (this) {
        AppTimeout.Type.IMMEDIATELY -> VowkeyString.immediately
        AppTimeout.Type.ONE_MINUTE -> VowkeyString.one_minute
        AppTimeout.Type.FIVE_MINUTES -> VowkeyString.five_minutes
        AppTimeout.Type.FIFTEEN_MINUTES -> VowkeyString.fifteen_minutes
        AppTimeout.Type.THIRTY_MINUTES -> VowkeyString.thirty_minutes
        AppTimeout.Type.ONE_HOUR -> VowkeyString.one_hour
        AppTimeout.Type.FOUR_HOURS -> VowkeyString.four_hours
        AppTimeout.Type.ON_APP_RESTART -> VowkeyString.on_restart
        AppTimeout.Type.NEVER -> VowkeyString.never
    }
        .asText()
