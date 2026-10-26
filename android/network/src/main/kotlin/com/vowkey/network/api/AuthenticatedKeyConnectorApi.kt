package com.vowkey.network.api

import androidx.annotation.Keep
import com.vowkey.network.model.KeyConnectorMasterKeyRequestJson
import com.vowkey.network.model.NetworkResult
import retrofit2.http.Body
import retrofit2.http.POST
import retrofit2.http.Url

/**
 * Defines raw calls specific for key connectors that use custom urls.
 */
@Keep
internal interface AuthenticatedKeyConnectorApi {
    @POST
    suspend fun storeMasterKeyToKeyConnector(
        @Url url: String,
        @Body body: KeyConnectorMasterKeyRequestJson,
    ): NetworkResult<Unit>
}
