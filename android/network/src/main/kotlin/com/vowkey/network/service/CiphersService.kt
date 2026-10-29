package com.vowkey.network.service

import com.vowkey.network.model.ArchiveCipherResponseJson
import com.vowkey.network.model.AttachmentInfo
import com.vowkey.network.model.AttachmentJsonRequest
import com.vowkey.network.model.AttachmentJsonResponse
import com.vowkey.network.model.BulkShareCiphersJsonRequest
import com.vowkey.network.model.CipherJsonRequest
import com.vowkey.network.model.CipherMiniResponseJson
import com.vowkey.network.model.CreateCipherInOrganizationJsonRequest
import com.vowkey.network.model.CreateCipherResponseJson
import com.vowkey.network.model.GetCipherResponse
import com.vowkey.network.model.ImportCiphersJsonRequest
import com.vowkey.network.model.ImportCiphersResponseJson
import com.vowkey.network.model.ShareCipherJsonRequest
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.network.model.UnarchiveCipherResponseJson
import com.vowkey.network.model.UpdateCipherCollectionsJsonRequest
import com.vowkey.network.model.UpdateCipherCollectionsResponseJson
import com.vowkey.network.model.UpdateCipherResponseJson
import java.io.File

/**
 * Provides an API for querying ciphers endpoints.
 */
@Suppress("TooManyFunctions")
interface CiphersService {
    /**
     * Attempt to archive a cipher.
     */
    suspend fun archiveCipher(cipherId: String): Result<ArchiveCipherResponseJson>

    /**
     * Attempt to unarchive a cipher.
     */
    suspend fun unarchiveCipher(cipherId: String): Result<UnarchiveCipherResponseJson>

    /**
     * Attempt to create a cipher.
     */
    suspend fun createCipher(body: CipherJsonRequest): Result<CreateCipherResponseJson>

    suspend fun createCipher(body: kotlinx.serialization.json.JsonObject): Result<CreateCipherResponseJson>

    /**
     * Attempt to create a cipher that belongs to an organization.
     */
    suspend fun createCipherInOrganization(
        body: CreateCipherInOrganizationJsonRequest,
    ): Result<CreateCipherResponseJson>

    /**
     * Attempt to upload an attachment file.
     */
    suspend fun uploadAttachment(
        attachment: AttachmentJsonResponse.Success,
        encryptedFile: File,
    ): Result<SyncResponseJson.Cipher>

    /**
     * Attempt to create an attachment.
     */
    suspend fun createAttachment(
        cipherId: String,
        body: AttachmentJsonRequest,
    ): Result<AttachmentJsonResponse>

    /**
     * Attempt to update a cipher.
     */
    suspend fun updateCipher(
        cipherId: String,
        body: CipherJsonRequest,
    ): Result<UpdateCipherResponseJson>

    suspend fun updateCipher(
        cipherId: String,
        body: kotlinx.serialization.json.JsonObject,
    ): Result<UpdateCipherResponseJson>

    /**
     * Attempt to share a cipher.
     */
    suspend fun shareCipher(
        cipherId: String,
        body: ShareCipherJsonRequest,
    ): Result<SyncResponseJson.Cipher>

    /**
     * Attempt to share multiple ciphers in bulk.
     */
    suspend fun bulkShareCiphers(
        body: BulkShareCiphersJsonRequest,
    ): Result<CipherMiniResponseJson>

    /**
     * Attempt to share an attachment.
     */
    suspend fun shareAttachment(
        cipherId: String,
        attachment: AttachmentInfo,
        organizationId: String,
        encryptedFile: File,
    ): Result<Unit>

    /**
     * Attempt to update a cipher's collections.
     */
    suspend fun updateCipherCollections(
        cipherId: String,
        body: UpdateCipherCollectionsJsonRequest,
    ): Result<UpdateCipherCollectionsResponseJson>

    /**
     * Attempt to hard delete a cipher.
     */
    suspend fun hardDeleteCipher(cipherId: String): Result<Unit>

    /**
     * Attempt to soft delete a cipher.
     */
    suspend fun softDeleteCipher(cipherId: String): Result<Unit>

    /**
     * Attempt to delete an attachment from a cipher.
     */
    suspend fun deleteCipherAttachment(
        cipherId: String,
        attachmentId: String,
    ): Result<Unit>

    /**
     * Attempt to restore a cipher.
     */
    suspend fun restoreCipher(cipherId: String): Result<SyncResponseJson.Cipher>

    /**
     * Attempt to retrieve a cipher.
     */
    suspend fun getCipher(cipherId: String): Result<GetCipherResponse>

    suspend fun getCipherJson(cipherId: String): Result<kotlinx.serialization.json.JsonObject>

    /**
     * Attempt to retrieve a cipher's attachment data.
     */
    suspend fun getCipherAttachment(
        cipherId: String,
        attachmentId: String,
    ): Result<SyncResponseJson.Cipher.Attachment>

    /**
     * Returns a boolean indicating if the active user has unassigned ciphers.
     */
    suspend fun hasUnassignedCiphers(): Result<Boolean>

    /**
     * Attempt to import ciphers.
     */
    suspend fun importCiphers(request: ImportCiphersJsonRequest): Result<ImportCiphersResponseJson>
}
