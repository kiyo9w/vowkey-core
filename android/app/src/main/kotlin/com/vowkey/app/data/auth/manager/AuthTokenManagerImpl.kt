package com.vowkey.app.data.auth.manager

import com.vowkey.network.model.AuthTokenData
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource

/**
 * Default implementation of [AuthTokenManager].
 */
class AuthTokenManagerImpl(
    private val authDiskSource: AuthDiskSource,
) : AuthTokenManager {

    override fun getAuthTokenDataOrNull(userId: String): AuthTokenData? =
        authDiskSource
            .getAccountTokens(userId = userId)
            ?.takeIf { it.accessToken != null }
            ?.let {
                AuthTokenData(
                    userId = userId,
                    accessToken = requireNotNull(it.accessToken),
                    expiresAtSec = it.expiresAtSec,
                )
            }

    override fun getAuthTokenDataOrNull(): AuthTokenData? = authDiskSource
        .userState
        ?.activeUserId
        ?.let(::getAuthTokenDataOrNull)
}
