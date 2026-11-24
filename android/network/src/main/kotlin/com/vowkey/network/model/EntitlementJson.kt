package com.vowkey.network.model

import kotlinx.serialization.Serializable

@Serializable
data class EntitlementJson(
    val basePlan: String,
    val storageKb: Long,
    val seats: Int,
    val decisionPerDay: Int,
    val hostedAgent: Boolean,
    val storageUsedBytes: Long,
    val usedToday: Int,
    val creditUnits: Long,
)

@Serializable
data class EntitlementResponseJson(
    val personal: EntitlementJson,
    val organizations: List<EntitlementJson> = emptyList(),
)
