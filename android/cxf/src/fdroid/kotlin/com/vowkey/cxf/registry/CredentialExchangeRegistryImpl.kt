package com.vowkey.cxf.registry

import android.app.Application
import androidx.credentials.providerevents.transfer.ClearExportResponse
import androidx.credentials.providerevents.transfer.RegisterExportResponse
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.core.data.util.asFailure
import com.vowkey.cxf.registry.model.RegistrationRequest

/**
 * F-Droid implementation of [CredentialExchangeRegistry]. Registration relies on the Play Services
 * backend, which is not available on F-Droid builds, so registration is a no-op that always fails.
 */
@OmitFromCoverage
@Suppress("UnusedParameter")
internal class CredentialExchangeRegistryImpl(
    application: Application,
) : CredentialExchangeRegistry {

    override suspend fun register(
        registrationRequest: RegistrationRequest,
    ): Result<RegisterExportResponse> =
        UnsupportedOperationException("Credential exchange is not supported on F-Droid builds.")
            .asFailure()

    override suspend fun unregister(): Result<ClearExportResponse> =
        UnsupportedOperationException("Credential exchange is not supported on F-Droid builds.")
            .asFailure()
}
