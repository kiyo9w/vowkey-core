package com.vowkey.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Represents a request to create an attachment.
 */
@Serializable
data class AttachmentJsonRequest(
    @SerialName("fileName")
    val fileName: String?,

    @SerialName("key")
    val key: String?,

    @SerialName("fileSize")
    val fileSize: String?,

    @SerialName("bytesChecksum") val bytesChecksum: String? = null,
    @SerialName("migrationId") val migrationId: String? = null,
    @SerialName("localResourceId") val localResourceId: String? = null,
    @SerialName("requestHash") val requestHash: String? = null,
)
