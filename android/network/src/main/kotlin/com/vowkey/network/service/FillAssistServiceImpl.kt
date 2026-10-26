package com.vowkey.network.service

import com.vowkey.network.api.FillAssistApi
import com.vowkey.network.model.FillAssistFormsJson
import com.vowkey.network.model.FillAssistManifestJson
import com.vowkey.network.util.toResult

/**
 * Default implementation of [FillAssistService].
 */
internal class FillAssistServiceImpl(
    private val api: FillAssistApi,
) : FillAssistService {

    override suspend fun getManifest(): Result<FillAssistManifestJson> =
        api.getManifest().toResult()

    override suspend fun getForms(filename: String): Result<FillAssistFormsJson> =
        api.getForms(filename = filename).toResult()
}
