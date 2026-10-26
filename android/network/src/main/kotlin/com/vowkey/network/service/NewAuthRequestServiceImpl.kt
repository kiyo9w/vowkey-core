package com.vowkey.network.service

import com.vowkey.core.data.util.asFailure
import com.vowkey.network.api.AuthenticatedAuthRequestsApi
import com.vowkey.network.api.UnauthenticatedAuthRequestsApi
import com.vowkey.network.model.AuthRequestRequestJson
import com.vowkey.network.model.AuthRequestTypeJson
import com.vowkey.network.model.AuthRequestsResponseJson
import com.vowkey.network.util.toResult

/**
 * The default implementation of the [NewAuthRequestService].
 */
internal class NewAuthRequestServiceImpl(
    private val authenticatedAuthRequestsApi: AuthenticatedAuthRequestsApi,
    private val unauthenticatedAuthRequestsApi: UnauthenticatedAuthRequestsApi,
) : NewAuthRequestService {
    override suspend fun createAuthRequest(
        email: String,
        publicKey: String,
        deviceId: String,
        accessCode: String,
        fingerprint: String,
        authRequestType: AuthRequestTypeJson,
    ): Result<AuthRequestsResponseJson.AuthRequest> =
        when (authRequestType) {
            AuthRequestTypeJson.LOGIN_WITH_DEVICE -> {
                unauthenticatedAuthRequestsApi
                    .createAuthRequest(
                        body = AuthRequestRequestJson(
                            email = email,
                            publicKey = publicKey,
                            deviceId = deviceId,
                            accessCode = accessCode,
                            fingerprint = fingerprint,
                            type = authRequestType,
                        ),
                    )
                    .toResult()
            }

            AuthRequestTypeJson.UNLOCK -> {
                UnsupportedOperationException("Unlock AuthRequestType is currently unsupported")
                    .asFailure()
            }

            AuthRequestTypeJson.ADMIN_APPROVAL -> {
                authenticatedAuthRequestsApi
                    .createAdminAuthRequest(
                        deviceIdentifier = deviceId,
                        body = AuthRequestRequestJson(
                            email = email,
                            publicKey = publicKey,
                            deviceId = deviceId,
                            accessCode = accessCode,
                            fingerprint = fingerprint,
                            type = authRequestType,
                        ),
                    )
                    .toResult()
            }
        }

    override suspend fun getAuthRequestUpdate(
        requestId: String,
        accessCode: String,
        isSso: Boolean,
    ): Result<AuthRequestsResponseJson.AuthRequest> =
        if (isSso) {
            authenticatedAuthRequestsApi
                .getAuthRequest(requestId = requestId)
                .toResult()
        } else {
            unauthenticatedAuthRequestsApi
                .getAuthRequestUpdate(
                    requestId = requestId,
                    accessCode = accessCode,
                )
                .toResult()
        }
}
