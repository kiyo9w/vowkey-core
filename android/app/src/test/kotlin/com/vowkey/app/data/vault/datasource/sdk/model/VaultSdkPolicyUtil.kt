package com.vowkey.app.data.vault.datasource.sdk.model

import com.vowkey.policies.Policy
import com.vowkey.policies.PolicyType
import java.time.Instant

/**
 * Create a mock [Policy] with a given [number].
 */
@Suppress("LongParameterList")
fun createMockSdkPolicy(
    number: Int = 1,
    id: String = "mockId-$number",
    organizationId: String = "mockOrganizationId-$number",
    type: PolicyType = PolicyType.MASTER_PASSWORD,
    data: String? = null,
    enabled: Boolean = false,
    revisionDate: Instant? = null,
): Policy =
    Policy(
        id = id,
        organizationId = organizationId,
        type = type,
        data = data,
        enabled = enabled,
        revisionDate = revisionDate,
    )
