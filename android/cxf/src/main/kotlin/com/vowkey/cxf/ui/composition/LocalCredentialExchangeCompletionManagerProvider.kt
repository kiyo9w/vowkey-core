@file:OmitFromCoverage

package com.vowkey.cxf.ui.composition

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.cxf.manager.CredentialExchangeCompletionManager

/**
 * Provides access to the Credential Exchange completion manager throughout the app.
 */
@Suppress("MaxLineLength")
val LocalCredentialExchangeCompletionManager: ProvidableCompositionLocal<CredentialExchangeCompletionManager> =
    compositionLocalOf {
        error("CompositionLocal LocalCredentialExchangeCompletionManager not present")
    }
