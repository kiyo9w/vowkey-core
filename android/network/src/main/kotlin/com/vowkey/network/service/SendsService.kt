package com.vowkey.network.service

import com.vowkey.network.model.CreateFileSendResponse
import com.vowkey.network.model.CreateFileSendResponseJson
import com.vowkey.network.model.CreateSendJsonResponse
import com.vowkey.network.model.GetSendResponse
import com.vowkey.network.model.SendJsonRequest
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.network.model.UpdateSendResponseJson
import java.io.File

/**
 * Provides an API for querying sends endpoints.
 */
interface SendsService {
    /**
     * Attempt to create a text send.
     */
    suspend fun createTextSend(
        body: SendJsonRequest,
    ): Result<CreateSendJsonResponse>

    /**
     * Attempt to create a file send.
     */
    suspend fun createFileSend(
        body: SendJsonRequest,
    ): Result<CreateFileSendResponse>

    /**
     * Attempt to upload the given [encryptedFile] associated with the [sendFileResponse].
     */
    suspend fun uploadFile(
        sendFileResponse: CreateFileSendResponseJson,
        encryptedFile: File,
    ): Result<SyncResponseJson.Send>

    /**
     * Attempt to update a send.
     */
    suspend fun updateSend(
        sendId: String,
        body: SendJsonRequest,
    ): Result<UpdateSendResponseJson>

    /**
     * Attempt to delete a Send.
     */
    suspend fun deleteSend(
        sendId: String,
    ): Result<Unit>

    /**
     * Attempt to remove password protection from a send.
     */
    suspend fun removeSendPassword(
        sendId: String,
    ): Result<UpdateSendResponseJson>

    /**
     * Attempt to retrieve a Send.
     */
    suspend fun getSend(sendId: String): Result<GetSendResponse>
}
