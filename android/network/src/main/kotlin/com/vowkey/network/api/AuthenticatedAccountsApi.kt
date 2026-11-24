package com.vowkey.network.api

import com.vowkey.network.model.CreateAccountKeysRequest
import com.vowkey.network.model.CreateAccountKeysResponseJson
import com.vowkey.network.model.DeleteAccountRequestJson
import com.vowkey.network.model.NetworkResult
import com.vowkey.network.model.ResetPasswordRequestJson
import com.vowkey.network.model.SetPasswordRequestJson
import com.vowkey.network.model.UpdateKdfJsonRequest
import com.vowkey.network.model.VerifyOtpRequestJson
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import retrofit2.http.Body
import retrofit2.http.HTTP
import retrofit2.http.POST
import retrofit2.http.PUT

/**
 * Defines raw calls under the /accounts API with authentication applied.
 */
internal interface AuthenticatedAccountsApi {

    /**
     * Converts the currently active account to a key-connector account.
     */
    @POST("/accounts/convert-to-key-connector")
    suspend fun convertToKeyConnector(): NetworkResult<Unit>

    /**
     * Creates the keys for the current account.
     */
    @POST("/accounts/keys")
    suspend fun createAccountKeys(
        @Body body: CreateAccountKeysRequest,
    ): NetworkResult<CreateAccountKeysResponseJson>

    /**
     * Deletes the current account.
     */
    @HTTP(method = "DELETE", path = "/accounts", hasBody = true)
    suspend fun deleteAccount(@Body body: DeleteAccountRequestJson): NetworkResult<Unit>

    @POST("/accounts/request-otp")
    suspend fun requestOtp(): NetworkResult<Unit>

    @POST("/accounts/guest-attached")
    suspend fun guestAttached(@Body body: GuestAttachedRequest): NetworkResult<Unit>

    /**
     * Update the KDF settings for the current account.
     */
    @POST("/accounts/kdf")
    suspend fun updateKdf(@Body body: UpdateKdfJsonRequest): NetworkResult<Unit>

    @POST("/accounts/verify-otp")
    suspend fun verifyOtp(
        @Body body: VerifyOtpRequestJson,
    ): NetworkResult<Unit>

    /**
     * Resets the temporary password.
     */
    @PUT("/accounts/update-temp-password")
    suspend fun resetTempPassword(@Body body: ResetPasswordRequestJson): NetworkResult<Unit>

    /**
     * Resets the password.
     */
    @POST("/accounts/password")
    suspend fun resetPassword(@Body body: ResetPasswordRequestJson): NetworkResult<Unit>

    /**
     * Sets the password.
     */
    @POST("/accounts/set-password")
    suspend fun setPassword(@Body body: SetPasswordRequestJson): NetworkResult<Unit>
}

@Serializable
data class GuestAttachedRequest(@SerialName("newAccount") val newAccount: Boolean)
