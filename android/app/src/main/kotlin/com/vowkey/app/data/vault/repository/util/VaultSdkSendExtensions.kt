@file:Suppress("TooManyFunctions")

package com.vowkey.app.data.vault.repository.util

import com.vowkey.core.data.repository.util.SpecialCharWithPrecedenceComparator
import com.vowkey.network.model.SendAuthTypeJson
import com.vowkey.network.model.SendJsonRequest
import com.vowkey.network.model.SendTypeJson
import com.vowkey.network.model.SyncResponseJson
import com.vowkey.send.AuthType
import com.vowkey.send.Send
import com.vowkey.send.SendFile
import com.vowkey.send.SendText
import com.vowkey.send.SendType
import com.vowkey.send.SendView

/**
 * Converts a Vowkey SDK [Send] object to a corresponding [SyncResponseJson.Send] object.
 */
fun Send.toEncryptedNetworkSend(fileLength: Long? = null): SendJsonRequest =
    SendJsonRequest(
        type = type.toNetworkSendType(),
        name = name,
        notes = notes,
        key = key,
        maxAccessCount = maxAccessCount?.toInt(),
        expirationDate = expirationDate,
        deletionDate = deletionDate,
        fileLength = fileLength,
        file = file?.toNetworkSendFile(),
        text = text?.toNetworkSendText(),
        password = password,
        isDisabled = disabled,
        shouldHideEmail = hideEmail,
        authType = authType.toNetworkSendAuthType(),
        emails = emails,
    )

/**
 * Converts a Vowkey SDK [SendFile] object to a corresponding [SyncResponseJson.Send.File]
 * object.
 */
private fun SendFile.toNetworkSendFile(): SyncResponseJson.Send.File =
    SyncResponseJson.Send.File(
        fileName = fileName,
        size = size?.toInt(),
        sizeName = sizeName,
        id = id,
    )

/**
 * Converts a Vowkey SDK [SendText] object to a corresponding [SyncResponseJson.Send.Text]
 * object.
 */
private fun SendText.toNetworkSendText(): SyncResponseJson.Send.Text =
    SyncResponseJson.Send.Text(
        isHidden = hidden,
        text = text,
    )

/**
 * Converts a Vowkey SDK [SendType] object to a corresponding [SendTypeJson] object.
 */
private fun SendType.toNetworkSendType(): SendTypeJson =
    when (this) {
        SendType.TEXT -> SendTypeJson.TEXT
        SendType.FILE -> SendTypeJson.FILE
        SendType.ITEM -> TODO("[PM-41095] Support Item SendType")
    }

/**
 * Converts a list of [SyncResponseJson.Send] objects to a list of corresponding
 * Vowkey SDK [Send] objects.
 */
fun List<SyncResponseJson.Send>.toEncryptedSdkSendList(): List<Send> =
    map { it.toEncryptedSdkSend() }

/**
 * Converts a [SyncResponseJson.Send] object to a corresponding
 * Vowkey SDK [Send] object.
 */
fun SyncResponseJson.Send.toEncryptedSdkSend(): Send =
    Send(
        id = id,
        accessId = accessId.toString(),
        name = name.toString(),
        notes = notes,
        key = key.toString(),
        password = password,
        type = type.toSdkSendType(),
        file = file?.toEncryptedSdkFile(),
        text = text?.toEncryptedSdkText(),
        // Item sends are not supported yet, see [PM-41095].
        data = null,
        maxAccessCount = maxAccessCount?.toUInt(),
        accessCount = accessCount.toUInt(),
        disabled = isDisabled,
        hideEmail = shouldHideEmail,
        revisionDate = revisionDate,
        deletionDate = deletionDate,
        expirationDate = expirationDate,
        emails = emails,
        authType = authType?.toSdkAuthType() ?: AuthType.NONE,
    )

/**
 * Converts a Vowkey SDK [AuthType] object to a corresponding [SendAuthTypeJson] object.
 */
private fun AuthType.toNetworkSendAuthType(): SendAuthTypeJson =
    when (this) {
        AuthType.EMAIL -> SendAuthTypeJson.EMAIL
        AuthType.PASSWORD -> SendAuthTypeJson.PASSWORD
        AuthType.NONE -> SendAuthTypeJson.NONE
    }

/**
 * Converts a [SendAuthTypeJson] objects to a corresponding
 * Vowkey SDK [AuthType].
 */
private fun SendAuthTypeJson.toSdkAuthType(): AuthType =
    when (this) {
        SendAuthTypeJson.PASSWORD -> AuthType.PASSWORD
        SendAuthTypeJson.EMAIL -> AuthType.EMAIL
        SendAuthTypeJson.NONE -> AuthType.NONE
    }

/**
 * Converts a [SyncResponseJson.Send.Text] object to a corresponding
 * Vowkey SDK [SendText] object.
 */
private fun SyncResponseJson.Send.Text.toEncryptedSdkText(): SendText =
    SendText(
        text = text,
        hidden = isHidden,
    )

/**
 * Converts a [SyncResponseJson.Send.File] objects to a corresponding
 * Vowkey SDK [SendFile] object.
 */
private fun SyncResponseJson.Send.File.toEncryptedSdkFile(): SendFile =
    SendFile(
        id = id.toString(),
        fileName = fileName.toString(),
        size = size.toString(),
        sizeName = sizeName.toString(),
    )

/**
 * Converts a [SendTypeJson] objects to a corresponding
 * Vowkey SDK [SendType].
 */
private fun SendTypeJson.toSdkSendType(): SendType =
    when (this) {
        SendTypeJson.TEXT -> SendType.TEXT
        SendTypeJson.FILE -> SendType.FILE
    }

/**
 * Sorts the data in alphabetical order by name.
 */
@JvmName("toAlphabeticallySortedSendList")
fun List<SendView>.sortAlphabetically(): List<SendView> {
    return this.sortedWith(
        comparator = { send1, send2 ->
            SpecialCharWithPrecedenceComparator.compare(send1.name, send2.name)
        },
    )
}
