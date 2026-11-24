package com.vowkey.network.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * One usage count. The server drops the whole body when a field is outside its allowlist.
 */
@Serializable
data class CountJson(
    @SerialName("event") val event: String,
    @SerialName("surface") val surface: String,
    @SerialName("os") val os: String,
    @SerialName("locale") val locale: String,
    @SerialName("page") val page: String,
    @SerialName("count") val count: Int,
)
