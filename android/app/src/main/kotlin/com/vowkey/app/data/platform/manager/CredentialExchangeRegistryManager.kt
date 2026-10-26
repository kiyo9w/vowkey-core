package com.vowkey.app.data.platform.manager

import com.vowkey.app.data.platform.manager.model.RegisterExportResult
import com.vowkey.app.data.platform.manager.model.UnregisterExportResult

/**
 * Manager for registering for Credential Exchange Protocol export.
 */
interface CredentialExchangeRegistryManager {

    /**
     * Registers the application for Credential Exchange Protocol export.
     */
    suspend fun register(): RegisterExportResult

    /**
     * Unregisters the application for Credential Exchange Protocol export.
     */
    suspend fun unregister(): UnregisterExportResult
}
