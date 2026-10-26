package com.vowkey.app.data.vault.datasource.sdk.model

import com.vowkey.fido.CheckUserOptions
import com.vowkey.sdk.CheckUserAndPickCredentialForCreationResult
import com.vowkey.sdk.CheckUserResult
import com.vowkey.sdk.CipherViewWrapper
import com.vowkey.sdk.Fido2UserInterface
import com.vowkey.sdk.UiHint
import com.vowkey.vault.CipherView
import com.vowkey.vault.Fido2CredentialNewView

/**
 * Implementation of [Fido2UserInterface] for searching for matching FIDO 2 credentials.
 */
class Fido2CredentialSearchUserInterfaceImpl : Fido2UserInterface {
    override suspend fun checkUser(
        options: CheckUserOptions,
        hint: UiHint,
    ): CheckUserResult =
        CheckUserResult(
            userPresent = true,
            userVerified = true,
        )

    override suspend fun checkUserAndPickCredentialForCreation(
        options: CheckUserOptions,
        newCredential: Fido2CredentialNewView,
    ): CheckUserAndPickCredentialForCreationResult = throw IllegalStateException()

    // Always return true for this property because any problems with verification should
    // be handled downstream where the app can actually offer verification methods.
    override fun isVerificationEnabled(): Boolean = true

    override suspend fun pickCredentialForAuthentication(
        availableCredentials: List<CipherView>,
    ): CipherViewWrapper = throw IllegalStateException()
}
