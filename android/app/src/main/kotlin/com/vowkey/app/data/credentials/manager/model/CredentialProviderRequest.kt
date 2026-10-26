package com.vowkey.app.data.credentials.manager.model

import com.vowkey.app.data.credentials.model.CreateCredentialRequest
import com.vowkey.app.data.credentials.model.Fido2CredentialAssertionRequest
import com.vowkey.app.data.credentials.model.GetCredentialsRequest
import com.vowkey.app.data.credentials.model.ProviderGetPasswordCredentialRequest

/**
 * Represents a pending credential provider request to be processed by MainActivity.
 */
sealed class CredentialProviderRequest {
    /**
     * Request to create a new FIDO2 passkey credential.
     */
    data class CreateCredential(
        val request: CreateCredentialRequest,
    ) : CredentialProviderRequest()

    /**
     * Request to assert (authenticate with) an existing FIDO2 passkey.
     */
    data class Fido2Assertion(
        val request: Fido2CredentialAssertionRequest,
    ) : CredentialProviderRequest()

    /**
     * Request to retrieve a password credential.
     */
    data class GetPassword(
        val request: ProviderGetPasswordCredentialRequest,
    ) : CredentialProviderRequest()

    /**
     * Request to get available credentials (BeginGetCredential flow).
     */
    data class GetCredentials(
        val request: GetCredentialsRequest,
    ) : CredentialProviderRequest()
}
