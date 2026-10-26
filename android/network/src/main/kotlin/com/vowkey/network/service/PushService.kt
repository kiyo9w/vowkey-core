package com.vowkey.network.service

import com.vowkey.network.model.PushTokenRequest

/**
 * Provides an API for push tokens.
 */
interface PushService {
    /**
     * Updates the user's push token.
     */
    suspend fun putDeviceToken(
        body: PushTokenRequest,
    ): Result<Unit>
}
