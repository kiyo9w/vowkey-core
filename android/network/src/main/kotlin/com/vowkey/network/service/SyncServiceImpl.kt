package com.vowkey.network.service

import com.vowkey.network.api.SyncApi
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.network.util.toResult

internal class SyncServiceImpl(
    private val syncApi: SyncApi,
) : SyncService {
    override suspend fun sync(): Result<SyncResponseJson> = syncApi
        .sync()
        .toResult()

    override suspend fun getAccountRevisionDateMillis(): Result<Long> =
        syncApi
            .getAccountRevisionDateMillis()
            .toResult()
}
