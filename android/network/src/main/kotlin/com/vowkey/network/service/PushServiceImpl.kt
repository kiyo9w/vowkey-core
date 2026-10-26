package com.vowkey.network.service

import com.vowkey.network.api.PushApi
import com.vowkey.network.model.PushTokenRequest
import com.vowkey.network.util.toResult

/**
 * Default implementation of [PushService].
 */
internal class PushServiceImpl(
    private val pushApi: PushApi,
    private val appId: String,
) : PushService {
    override suspend fun putDeviceToken(
        body: PushTokenRequest,
    ): Result<Unit> =
        pushApi
            .putDeviceToken(
                appId = appId,
                body = body,
            )
            .toResult()
}
