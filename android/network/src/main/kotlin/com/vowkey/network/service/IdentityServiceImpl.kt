package com.vowkey.network.service

import com.vowkey.network.api.UnauthenticatedIdentityApi
import com.vowkey.network.model.GetTokenResponseJson
import com.vowkey.network.model.IdentityTokenAuthModel
import com.vowkey.network.model.PreLoginRequestJson
import com.vowkey.network.model.PreLoginResponseJson
import com.vowkey.network.model.PrevalidateSsoResponseJson
import com.vowkey.network.model.RefreshTokenResponseJson
import com.vowkey.network.model.RegisterFinishRequestJson
import com.vowkey.network.model.RegisterResponseJson
import com.vowkey.network.model.SendVerificationEmailRequestJson
import com.vowkey.network.model.SendVerificationEmailResponseJson
import com.vowkey.network.model.TwoFactorDataModel
import com.vowkey.network.model.VerifyEmailTokenRequestJson
import com.vowkey.network.model.VerifyEmailTokenResponseJson
import com.vowkey.network.model.toVowkeyError
import com.vowkey.network.util.DeviceModelProvider
import com.vowkey.network.util.NetworkErrorCode
import com.vowkey.network.util.executeForNetworkResult
import com.vowkey.network.util.getNetworkErrorCodeOrNull
import com.vowkey.network.util.parseErrorBodyOrNull
import com.vowkey.network.util.toResult
import kotlinx.serialization.json.Json

internal class IdentityServiceImpl(
    private val unauthenticatedIdentityApi: UnauthenticatedIdentityApi,
    private val json: Json,
    private val deviceModelProvider: DeviceModelProvider = DeviceModelProvider(),
) : IdentityService {

    override suspend fun preLogin(email: String): Result<PreLoginResponseJson> =
        unauthenticatedIdentityApi
            .preLogin(PreLoginRequestJson(email = email))
            .toResult()

    override suspend fun getToken(
        uniqueAppId: String,
        deeplinkScheme: String,
        email: String,
        authModel: IdentityTokenAuthModel,
        twoFactorData: TwoFactorDataModel?,
        newDeviceOtp: String?,
    ): Result<GetTokenResponseJson> = unauthenticatedIdentityApi
        .getToken(
            scope = "api offline_access",
            clientId = "mobile",
            deviceIdentifier = uniqueAppId,
            deviceName = deviceModelProvider.deviceModel,
            deviceType = "0",
            grantType = authModel.grantType,
            passwordHash = authModel.password,
            email = email,
            ssoCode = authModel.ssoCode,
            ssoCodeVerifier = authModel.ssoCodeVerifier,
            ssoRedirectUri = authModel.ssoRedirectUri,
            twoFactorCode = twoFactorData?.code,
            twoFactorMethod = twoFactorData?.method,
            twoFactorRemember = twoFactorData?.remember?.let { if (it) "1" else "0 " },
            authRequestId = authModel.authRequestId,
            newDeviceOtp = newDeviceOtp,
            deeplinkScheme = deeplinkScheme,
        )
        .toResult()
        .recoverCatching { throwable ->
            val vowkeyError = throwable.toVowkeyError()
            vowkeyError
                .parseErrorBodyOrNull<GetTokenResponseJson.TwoFactorRequired>(
                    code = NetworkErrorCode.BAD_REQUEST,
                    json = json,
                )
                ?: vowkeyError.parseErrorBodyOrNull<GetTokenResponseJson.Invalid>(
                    code = NetworkErrorCode.BAD_REQUEST,
                    json = json,
                )
                ?: throw throwable
        }

    override suspend fun prevalidateSso(
        organizationIdentifier: String,
    ): Result<PrevalidateSsoResponseJson> = unauthenticatedIdentityApi
        .prevalidateSso(
            organizationIdentifier = organizationIdentifier,
        )
        .toResult()
        .recoverCatching { throwable ->
            val vowkeyError = throwable.toVowkeyError()
            vowkeyError
                .parseErrorBodyOrNull<PrevalidateSsoResponseJson.Error>(
                    code = NetworkErrorCode.BAD_REQUEST,
                    json = json,
                )
                ?: throw throwable
        }

    override fun refreshTokenSynchronously(
        refreshToken: String,
    ): Result<RefreshTokenResponseJson> = unauthenticatedIdentityApi
        .refreshTokenCall(
            clientId = "mobile",
            grantType = "refresh_token",
            refreshToken = refreshToken,
        )
        .executeForNetworkResult()
        .toResult()
        .recoverCatching { throwable ->
            val vowkeyError = throwable.toVowkeyError()
            vowkeyError
                .parseErrorBodyOrNull<RefreshTokenResponseJson.Error>(
                    code = NetworkErrorCode.BAD_REQUEST,
                    json = json,
                )
                ?: run {
                    when (vowkeyError.getNetworkErrorCodeOrNull()) {
                        NetworkErrorCode.UNAUTHORIZED -> {
                            RefreshTokenResponseJson.Unauthorized(throwable)
                        }

                        NetworkErrorCode.FORBIDDEN -> {
                            RefreshTokenResponseJson.Forbidden(throwable)
                        }

                        NetworkErrorCode.BAD_REQUEST,
                        NetworkErrorCode.NOT_FOUND,
                        NetworkErrorCode.TOO_MANY_REQUESTS,
                        null,
                            -> throw throwable
                    }
                }
        }

    override suspend fun registerFinish(
        body: RegisterFinishRequestJson,
    ): Result<RegisterResponseJson> =
        unauthenticatedIdentityApi
            .registerFinish(body)
            .toResult()
            .recoverCatching { throwable ->
                val vowkeyError = throwable.toVowkeyError()
                vowkeyError
                    .parseErrorBodyOrNull<RegisterResponseJson.Invalid>(
                        codes = listOf(
                            NetworkErrorCode.BAD_REQUEST,
                            NetworkErrorCode.TOO_MANY_REQUESTS,
                        ),
                        json = json,
                    )
                    ?: throw throwable
            }

    override suspend fun sendVerificationEmail(
        body: SendVerificationEmailRequestJson,
    ): Result<SendVerificationEmailResponseJson> {
        return unauthenticatedIdentityApi
            .sendVerificationEmail(body = body)
            .toResult()
            .map { SendVerificationEmailResponseJson.Success(it?.content) }
            .recoverCatching { throwable ->
                throwable
                    .toVowkeyError()
                    .parseErrorBodyOrNull<SendVerificationEmailResponseJson.Invalid>(
                        code = NetworkErrorCode.BAD_REQUEST,
                        json = json,
                    )
                    ?: throw throwable
            }
    }

    override suspend fun verifyEmailRegistrationToken(
        body: VerifyEmailTokenRequestJson,
    ): Result<VerifyEmailTokenResponseJson> = unauthenticatedIdentityApi
        .verifyEmailToken(
            body = body,
        )
        .toResult()
        .map { VerifyEmailTokenResponseJson.Valid }
        .recoverCatching { throwable ->
            val vowkeyError = throwable.toVowkeyError()
            vowkeyError
                .parseErrorBodyOrNull<VerifyEmailTokenResponseJson.Invalid>(
                    code = NetworkErrorCode.BAD_REQUEST,
                    json = json,
                )
                ?.checkForExpiredMessage()
                ?: throw throwable
        }
}

/**
 * If the message body contains text related to the token being expired, return
 * the TokenExpired type. Otherwise, return the original Invalid response.
 */
private fun VerifyEmailTokenResponseJson.Invalid.checkForExpiredMessage() =
    if (message.contains(other = "expired", ignoreCase = true)) {
        VerifyEmailTokenResponseJson.TokenExpired
    } else {
        this
    }
