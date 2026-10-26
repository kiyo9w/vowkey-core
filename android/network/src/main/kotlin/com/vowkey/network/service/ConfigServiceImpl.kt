package com.vowkey.network.service

import com.vowkey.network.api.ConfigApi
import com.vowkey.network.model.ConfigResponseJson
import com.vowkey.network.util.toResult

/**
 * Default implementation of [ConfigService] for querying app configurations.
 */
internal class ConfigServiceImpl(private val configApi: ConfigApi) : ConfigService {
    override suspend fun getConfig(): Result<ConfigResponseJson> = configApi.getConfig().toResult()
}
