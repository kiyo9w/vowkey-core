package com.vowkey.app.data.vault.datasource.sdk.model

import com.vowkey.organizations.OrganizationUserStatusType
import com.vowkey.organizations.OrganizationUserType
import com.vowkey.policies.OrganizationUserPolicyContext

/**
 * Create a mock [OrganizationUserPolicyContext] with a given [number].
 */
@Suppress("LongParameterList")
fun createMockOrganizationUserPolicyContext(
    number: Int = 1,
    id: String = "mockId-$number",
    status: OrganizationUserStatusType = OrganizationUserStatusType.CONFIRMED,
    role: OrganizationUserType = OrganizationUserType.ADMIN,
    enabled: Boolean = false,
    usePolicies: Boolean = false,
    isProviderUser: Boolean = false,
): OrganizationUserPolicyContext =
    OrganizationUserPolicyContext(
        id = id,
        status = status,
        role = role,
        enabled = enabled,
        usePolicies = usePolicies,
        isProviderUser = isProviderUser,
    )
