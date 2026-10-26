@file:OmitFromCoverage

package com.vowkey.cxf.ui.composition

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.cxf.importer.CredentialExchangeImporter

/**
 * Provides access to the Credential Exchange importer throughout the app.
 */
val LocalCredentialExchangeImporter: ProvidableCompositionLocal<CredentialExchangeImporter> =
    compositionLocalOf {
        error("CompositionLocal LocalPermissionsManager not present")
    }
