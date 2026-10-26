package com.vowkey.app.ui.platform.util

import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Returns a human-readable display label for the given [Environment.Type].
 */
val Environment.Type.displayLabel: Text
    get() = when (this) {
        Environment.Type.US -> Environment.Prod.Us.label.asText()
        Environment.Type.EU -> Environment.Prod.Eu.label.asText()
        Environment.Type.SELF_HOSTED -> VowkeyString.self_hosted.asText()
        Environment.Type.FED_RAMP -> Environment.Prod.FedRamp.label.asText()
    }
