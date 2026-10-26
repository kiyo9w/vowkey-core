package com.vowkey.network.service

import com.vowkey.network.api.AuthenticatedDevicesApi
import com.vowkey.network.api.UnauthenticatedDevicesApi
import com.vowkey.network.model.DevicesResponseJson
import com.vowkey.network.model.TrustedDeviceKeysRequestJson
import com.vowkey.network.model.TrustedDeviceKeysResponseJson
import com.vowkey.network.util.base64UrlEncode
import com.vowkey.network.util.toResult

/**
 * The default implementation of the [DevicesService].
 */
internal class DevicesServiceImpl(
    private val authenticatedDevicesApi: AuthenticatedDevicesApi,
    private val unauthenticatedDevicesApi: UnauthenticatedDevicesApi,
) : DevicesService {
    override suspend fun getDevices(): Result<DevicesResponseJson> =
        authenticatedDevicesApi.getDevices().toResult()

    override suspend fun getIsKnownDevice(
        emailAddress: String,
        deviceId: String,
    ): Result<Boolean> = unauthenticatedDevicesApi
        .getIsKnownDevice(
            emailAddress = emailAddress.base64UrlEncode(),
            deviceId = deviceId,
        )
        .toResult()

    override suspend fun trustDevice(
        appId: String,
        encryptedUserKey: String,
        encryptedDevicePublicKey: String,
        encryptedDevicePrivateKey: String,
    ): Result<TrustedDeviceKeysResponseJson> = authenticatedDevicesApi
        .updateTrustedDeviceKeys(
            appId = appId,
            request = TrustedDeviceKeysRequestJson(
                encryptedUserKey = encryptedUserKey,
                encryptedDevicePublicKey = encryptedDevicePublicKey,
                encryptedDevicePrivateKey = encryptedDevicePrivateKey,
            ),
        )
        .toResult()
}
