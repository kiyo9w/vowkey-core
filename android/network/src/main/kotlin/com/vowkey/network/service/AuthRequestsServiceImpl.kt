package com.vowkey.network.service

import com.vowkey.network.api.AuthenticatedAuthRequestsApi
import com.vowkey.network.model.AuthRequestUpdateRequestJson
import com.vowkey.network.model.AuthRequestsResponseJson
import com.vowkey.network.util.toResult

internal class AuthRequestsServiceImpl(
    private val authenticatedAuthRequestsApi: AuthenticatedAuthRequestsApi,
) : AuthRequestsService {
    override suspend fun getAuthRequests(): Result<AuthRequestsResponseJson> =
        authenticatedAuthRequestsApi
            .getAuthRequests()
            .toResult()

    override suspend fun getAuthRequest(
        requestId: String,
    ): Result<AuthRequestsResponseJson.AuthRequest> =
        authenticatedAuthRequestsApi
            .getAuthRequest(requestId = requestId)
            .toResult()

    override suspend fun updateAuthRequest(
        requestId: String,
        key: String,
        masterPasswordHash: String?,
        deviceId: String,
        isApproved: Boolean,
    ): Result<AuthRequestsResponseJson.AuthRequest> =
        authenticatedAuthRequestsApi
            .updateAuthRequest(
                userId = requestId,
                body = AuthRequestUpdateRequestJson(
                    key = key,
                    masterPasswordHash = masterPasswordHash,
                    deviceId = deviceId,
                    isApproved = isApproved,
                ),
            )
            .toResult()
}
