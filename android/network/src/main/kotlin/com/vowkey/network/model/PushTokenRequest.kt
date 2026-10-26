package com.vowkey.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Request body needed to PUT a GCM [pushToken] to Vowkey's server.
 */
@Serializable
data class PushTokenRequest(
    @SerialName("pushToken") val pushToken: String,
)
