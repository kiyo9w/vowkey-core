package com.vowkey.app.data.auth.repository.util

import com.vowkey.network.model.MasterPasswordPolicyOptionsJson
import com.vowkey.app.data.auth.repository.model.PolicyInformation

/**
 * Converts the [MasterPasswordPolicyOptionsJson] to a [PolicyInformation.MasterPassword].
 */
fun MasterPasswordPolicyOptionsJson.toPolicyInformation(): PolicyInformation.MasterPassword =
    PolicyInformation.MasterPassword(
        minLength = this.minimumLength,
        minComplexity = this.minimumComplexity,
        requireUpper = this.shouldRequireUppercase,
        requireLower = this.shouldRequireLowercase,
        requireNumbers = this.shouldRequireNumbers,
        requireSpecial = this.shouldRequireSpecialCharacters,
        enforceOnLogin = this.shouldEnforceOnLogin,
    )
