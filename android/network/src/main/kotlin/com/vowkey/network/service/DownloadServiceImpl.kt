package com.vowkey.network.service

import com.vowkey.network.api.DownloadApi
import com.vowkey.network.util.toResult
import okhttp3.ResponseBody

/**
 * Default implementation of [DownloadService].
 */
internal class DownloadServiceImpl(
    private val downloadApi: DownloadApi,
) : DownloadService {
    override suspend fun getDataStream(
        url: String,
    ): Result<ResponseBody> =
        downloadApi
            .getDataStream(url = url)
            .toResult()
}
