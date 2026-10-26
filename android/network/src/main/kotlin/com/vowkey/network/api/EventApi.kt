package com.vowkey.network.api

import com.vowkey.network.model.NetworkResult
import com.vowkey.network.model.OrganizationEventJson
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * This interface defines the API service for posting event data.
 */
internal interface EventApi {
    @POST("/collect")
    suspend fun collectOrganizationEvents(
        @Body events: List<OrganizationEventJson>,
    ): NetworkResult<Unit>
}
