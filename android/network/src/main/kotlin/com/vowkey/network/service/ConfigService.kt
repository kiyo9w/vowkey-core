package com.vowkey.network.service

import com.vowkey.network.model.ConfigResponseJson

/**
 * Provides an API for querying config endpoints.
 */
interface ConfigService {

    /**
     * Fetch app configuration.
     */
    suspend fun getConfig(): Result<ConfigResponseJson>
}
