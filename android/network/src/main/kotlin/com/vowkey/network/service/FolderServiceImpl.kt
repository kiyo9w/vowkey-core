package com.vowkey.network.service

import com.vowkey.network.api.FoldersApi
import com.vowkey.network.model.FolderJsonRequest
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.network.model.UpdateFolderResponseJson
import com.vowkey.network.model.toVowkeyError
import com.vowkey.network.util.NetworkErrorCode
import com.vowkey.network.util.parseErrorBodyOrNull
import com.vowkey.network.util.toResult
import kotlinx.serialization.json.Json

internal class FolderServiceImpl(
    private val foldersApi: FoldersApi,
    private val json: Json,
) : FolderService {
    override suspend fun createFolder(body: FolderJsonRequest): Result<SyncResponseJson.Folder> =
        foldersApi
            .createFolder(body = body)
            .toResult()

    override suspend fun updateFolder(
        folderId: String,
        body: FolderJsonRequest,
    ): Result<UpdateFolderResponseJson> =
        foldersApi
            .updateFolder(
                folderId = folderId,
                body = body,
            )
            .toResult()
            .map { UpdateFolderResponseJson.Success(folder = it) }
            .recoverCatching { throwable ->
                throwable
                    .toVowkeyError()
                    .parseErrorBodyOrNull<UpdateFolderResponseJson.Invalid>(
                        code = NetworkErrorCode.BAD_REQUEST,
                        json = json,
                    )
                    ?: throw throwable
            }

    override suspend fun deleteFolder(folderId: String): Result<Unit> =
        foldersApi
            .deleteFolder(folderId = folderId)
            .toResult()

    override suspend fun getFolder(
        folderId: String,
    ): Result<SyncResponseJson.Folder> = foldersApi
        .getFolder(folderId = folderId)
        .toResult()
}
