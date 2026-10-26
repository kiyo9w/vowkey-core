@file:OmitFromCoverage

package com.vowkey.cxf.util

import android.content.Intent
 import androidx.credentials.providerevents.IntentHandler
import androidx.credentials.providerevents.transfer.ProviderImportCredentialsRequest
import com.vowkey.annotation.OmitFromCoverage

/**
 * Retrieves the [ProviderImportCredentialsRequest] from the intent.
 */
fun Intent.getProviderImportCredentialsRequest(): ProviderImportCredentialsRequest? = IntentHandler
    .retrieveProviderImportCredentialsRequest(this)
