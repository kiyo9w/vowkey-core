package com.vowkey.app.ui.auth.feature.resetPassword.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.model.createMockMasterPasswordPolicy
import com.vowkey.app.ui.auth.feature.resetpassword.util.toDisplayLabels
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class PolicyInformationMasterPasswordExtensionsTest {
    @Test
    fun `toDisplayLabels with multiple minLength values should choose highest value`() {
        val policyList = listOf(
            createMockMasterPasswordPolicy(minLength = null),
            createMockMasterPasswordPolicy(minLength = 10),
            createMockMasterPasswordPolicy(minLength = 2),
        )
        assertEquals(
            listOf(VowkeyString.policy_in_effect_min_length.asText(10)),
            policyList.toDisplayLabels(),
        )
    }

    @Test
    fun `toDisplayLabels with multiple minComplexity values should choose highest value`() {
        val policyList = listOf(
            createMockMasterPasswordPolicy(minComplexity = null),
            createMockMasterPasswordPolicy(minComplexity = 1),
            createMockMasterPasswordPolicy(minComplexity = 2),
        )
        assertEquals(
            listOf(VowkeyString.policy_in_effect_min_complexity.asText(2)),
            policyList.toDisplayLabels(),
        )
    }

    @Test
    fun `toDisplayLabels lists any nonNull requirements`() {
        val policyList = listOf(
            createMockMasterPasswordPolicy(requireUpper = true),
            createMockMasterPasswordPolicy(requireLower = true),
            createMockMasterPasswordPolicy(requireNumbers = true),
            createMockMasterPasswordPolicy(requireSpecial = true),
        )
        assertEquals(
            listOf(
                VowkeyString.policy_in_effect_uppercase.asText(),
                VowkeyString.policy_in_effect_lowercase.asText(),
                VowkeyString.policy_in_effect_numbers.asText(),
                VowkeyString.policy_in_effect_special.asText(),
            ),
            policyList.toDisplayLabels(),
        )
    }
}
