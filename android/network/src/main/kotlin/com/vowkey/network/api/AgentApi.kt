package com.vowkey.network.api

import com.vowkey.network.model.NetworkResult
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.PUT
import retrofit2.http.Path

/** Account clients answer or revoke; only the bound executor can dispatch or report results. */
interface AgentApi {
    @GET("agent/sync")
    suspend fun sync(): NetworkResult<JsonObject>

    @PUT("agent/requests/{id}/answer")
    suspend fun answer(@Path("id") id: String, @Body body: JsonObject): NetworkResult<JsonObject>

    @PUT("agent/pairings/{id}")
    suspend fun updatePairing(@Path("id") id: String, @Body body: JsonObject): NetworkResult<JsonObject>

    @PUT("agent/grants/{id}")
    suspend fun updateGrant(@Path("id") id: String, @Body body: JsonObject): NetworkResult<JsonObject>
}
