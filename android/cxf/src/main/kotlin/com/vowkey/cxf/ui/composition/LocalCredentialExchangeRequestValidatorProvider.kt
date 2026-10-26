@file:OmitFromCoverage

package com.vowkey.cxf.ui.composition

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.cxf.validator.CredentialExchangeRequestValidator

/**
 * Provides access to the Credential Exchange request validator throughout the app.
 */
@Suppress("MaxLineLength")
val LocalCredentialExchangeRequestValidator: ProvidableCompositionLocal<CredentialExchangeRequestValidator> =
    compositionLocalOf {
        error("CompositionLocal LocalPermissionsManager not present")
    }
