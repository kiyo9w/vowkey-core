package com.vowkey.app.data.autofill.accessibility.util

import android.net.Uri
import androidx.core.net.toUri
import com.vowkey.annotation.OmitFromCoverage
import java.net.URISyntaxException

/**
 * Attempts to parse a [Uri] from a string and returns null if an error occurs.
 */
@OmitFromCoverage
fun String.toUriOrNull(): Uri? =
    try {
        this.toUri()
    } catch (_: URISyntaxException) {
        null
    }
