package com.vowkey.app.data.auth.repository.util

import com.vowkey.network.model.DeviceResponseJson
import com.vowkey.app.data.auth.repository.model.DeviceInfo
import com.vowkey.app.data.auth.repository.model.DevicePendingAuthRequest

/**
 * Maps the given [DeviceResponseJson] to a [DeviceInfo].
 */
fun DeviceResponseJson.toDeviceInfo(currentDeviceIdentifier: String): DeviceInfo =
    DeviceInfo(
        id = id,
        name = name,
        identifier = identifier,
        type = type,
        isTrusted = isTrusted,
        creationDate = creationDate,
        lastActivityDate = lastActivityDate,
        pendingAuthRequest = devicePendingAuthRequest?.let {
            DevicePendingAuthRequest(
                id = it.id,
                creationDate = it.creationDate,
            )
        },
        isCurrentDevice = identifier == currentDeviceIdentifier,
    )
