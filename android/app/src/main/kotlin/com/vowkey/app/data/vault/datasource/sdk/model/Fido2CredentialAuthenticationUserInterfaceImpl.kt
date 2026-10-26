package com.vowkey.app.data.vault.datasource.sdk.model

import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.fido.CheckUserOptions
import com.vowkey.sdk.CheckUserAndPickCredentialForCreationResult
import com.vowkey.sdk.CheckUserResult
import com.vowkey.sdk.CipherViewWrapper
import com.vowkey.sdk.Fido2UserInterface
import com.vowkey.sdk.UiHint
import com.vowkey.vault.CipherView
import com.vowkey.vault.Fido2CredentialNewView

/**
 * Implementation of [Fido2UserInterface] for authenticating with a FIDO 2 credential.
 */
@OmitFromCoverage
class Fido2CredentialAuthenticationUserInterfaceImpl(
    private val selectedCipherView: CipherView,
    private val isVerificationSupported: Boolean,
) : Fido2UserInterface {
    override suspend fun checkUser(
        options: CheckUserOptions,
        hint: UiHint,
    ): CheckUserResult = CheckUserResult(userPresent = true, userVerified = true)

    override suspend fun checkUserAndPickCredentialForCreation(
        options: CheckUserOptions,
        newCredential: Fido2CredentialNewView,
    ): CheckUserAndPickCredentialForCreationResult = throw IllegalStateException()

    override fun isVerificationEnabled(): Boolean = isVerificationSupported

    override suspend fun pickCredentialForAuthentication(
        availableCredentials: List<CipherView>,
    ): CipherViewWrapper = CipherViewWrapper(selectedCipherView)
}
