package com.vowkey.network.api

import com.vowkey.network.model.AttachmentJsonRequest
import com.vowkey.network.model.AttachmentJsonResponse
import com.vowkey.network.model.BulkShareCiphersJsonRequest
import com.vowkey.network.model.CipherJsonRequest
import com.vowkey.network.model.CipherMiniResponseJson
import com.vowkey.network.model.CreateCipherInOrganizationJsonRequest
import com.vowkey.network.model.ImportCiphersJsonRequest
import com.vowkey.network.model.NetworkResult
import com.vowkey.network.model.ShareCipherJsonRequest
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.network.model.UpdateCipherCollectionsJsonRequest
import com.vowkey.network.model.UpdateCipherCollectionsResponseJson
import okhttp3.MultipartBody
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.PUT
import retrofit2.http.Path
import retrofit2.http.Query

/**
 * Defines raw calls under the /ciphers API with authentication applied.
 */
@Suppress("TooManyFunctions")
internal interface CiphersApi {

    /**
     * Archive a cipher.
     */
    @PUT("ciphers/{cipherId}/archive")
    suspend fun archiveCipher(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Unarchive a cipher.
     */
    @PUT("ciphers/{cipherId}/unarchive")
    suspend fun unarchiveCipher(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Create a cipher.
     */
    @POST("ciphers")
    suspend fun createCipher(@Body body: CipherJsonRequest): NetworkResult<SyncResponseJson.Cipher>

    @POST("ciphers")
    suspend fun createCipherJson(
        @Body body: kotlinx.serialization.json.JsonObject,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Create a cipher that belongs to an organization.
     */
    @POST("ciphers/create")
    suspend fun createCipherInOrganization(
        @Body body: CreateCipherInOrganizationJsonRequest,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Associates an attachment with a cipher.
     */
    @POST("ciphers/{cipherId}/attachment/v2")
    suspend fun createAttachment(
        @Path("cipherId") cipherId: String,
        @Body body: AttachmentJsonRequest,
    ): NetworkResult<AttachmentJsonResponse.Success>

    /**
     * Uploads the attachment associated with a cipher.
     */
    @POST("ciphers/{cipherId}/attachment/{attachmentId}")
    suspend fun uploadAttachment(
        @Path("cipherId") cipherId: String,
        @Path("attachmentId") attachmentId: String,
        @Body body: MultipartBody,
    ): NetworkResult<Unit>

    /**
     * Updates a cipher.
     */
    @PUT("ciphers/{cipherId}")
    suspend fun updateCipher(
        @Path("cipherId") cipherId: String,
        @Body body: CipherJsonRequest,
    ): NetworkResult<SyncResponseJson.Cipher>

    @PUT("ciphers/{cipherId}")
    suspend fun updateCipherJson(
        @Path("cipherId") cipherId: String,
        @Body body: kotlinx.serialization.json.JsonObject,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Shares a cipher.
     */
    @PUT("ciphers/{cipherId}/share")
    suspend fun shareCipher(
        @Path("cipherId") cipherId: String,
        @Body body: ShareCipherJsonRequest,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Shares multiple ciphers in bulk.
     */
    @PUT("ciphers/share")
    suspend fun bulkShareCiphers(
        @Body body: BulkShareCiphersJsonRequest,
    ): NetworkResult<CipherMiniResponseJson>

    /**
     * Shares an attachment.
     */
    @POST("ciphers/{cipherId}/attachment/{attachmentId}/share")
    suspend fun shareAttachment(
        @Path("cipherId") cipherId: String,
        @Path("attachmentId") attachmentId: String,
        @Query("organizationId") organizationId: String?,
        @Body body: MultipartBody,
    ): NetworkResult<Unit>

    /**
     * Updates a cipher's collections.
     */
    @PUT("ciphers/{cipherId}/collections_v2")
    suspend fun updateCipherCollections(
        @Path("cipherId") cipherId: String,
        @Body body: UpdateCipherCollectionsJsonRequest,
    ): NetworkResult<UpdateCipherCollectionsResponseJson>

    /**
     * Hard deletes a cipher.
     */
    @DELETE("ciphers/{cipherId}")
    suspend fun hardDeleteCipher(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<Unit>

    /**
     * Soft deletes a cipher.
     */
    @PUT("ciphers/{cipherId}/delete")
    suspend fun softDeleteCipher(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<Unit>

    /**
     * Deletes an attachment from a cipher.
     */
    @DELETE("ciphers/{cipherId}/attachment/{attachmentId}")
    suspend fun deleteCipherAttachment(
        @Path("cipherId") cipherId: String,
        @Path("attachmentId") attachmentId: String,
    ): NetworkResult<Unit>

    /**
     * Restores a cipher.
     */
    @PUT("ciphers/{cipherId}/restore")
    suspend fun restoreCipher(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<SyncResponseJson.Cipher>

    /**
     * Gets a cipher.
     */
    @GET("ciphers/{cipherId}")
    suspend fun getCipher(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<SyncResponseJson.Cipher>

    @GET("ciphers/{cipherId}")
    suspend fun getCipherJson(
        @Path("cipherId") cipherId: String,
    ): NetworkResult<kotlinx.serialization.json.JsonObject>

    /**
     * Gets a cipher attachment.
     */
    @GET("ciphers/{cipherId}/attachment/{attachmentId}")
    suspend fun getCipherAttachment(
        @Path("cipherId") cipherId: String,
        @Path("attachmentId") attachmentId: String,
    ): NetworkResult<SyncResponseJson.Cipher.Attachment>

    /**
     * Indicates if the active user has unassigned ciphers.
     */
    @GET("ciphers/has-unassigned-ciphers")
    suspend fun hasUnassignedCiphers(): NetworkResult<Boolean>

    @POST("ciphers/import")
    suspend fun importCiphers(
        @Body body: ImportCiphersJsonRequest,
    ): NetworkResult<Unit>
}
