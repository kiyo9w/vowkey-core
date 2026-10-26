package com.vowkey.app.ui.platform.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.repository.model.VaultTimeoutAction

/**
 * Provides a human-readable display label for the given [VaultTimeoutAction].
 */
val VaultTimeoutAction.displayLabel: Text
    get() = when (this) {
        VaultTimeoutAction.LOCK -> VowkeyString.lock
        VaultTimeoutAction.LOGOUT -> VowkeyString.log_out
    }
        .asText()
