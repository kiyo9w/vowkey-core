package com.vowkey.app

import android.content.Intent
import com.vowkey.ui.platform.base.BaseViewModel
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.credentials.manager.VowkeyCredentialManager
import com.vowkey.app.data.credentials.manager.CredentialProviderRequestManager
import com.vowkey.app.data.credentials.manager.model.CredentialProviderRequest
import com.vowkey.app.data.credentials.model.CreateCredentialRequest
import com.vowkey.app.data.credentials.model.Fido2CredentialAssertionRequest
import com.vowkey.app.data.credentials.model.GetCredentialsRequest
import com.vowkey.app.data.credentials.model.ProviderGetPasswordCredentialRequest
import com.vowkey.app.data.credentials.util.getCreateCredentialRequestOrNull
import com.vowkey.app.data.credentials.util.getFido2AssertionRequestOrNull
import com.vowkey.app.data.credentials.util.getGetCredentialsRequestOrNull
import com.vowkey.app.data.credentials.util.getProviderGetPasswordRequestOrNull
import com.vowkey.app.ui.platform.feature.rootnav.RootNavViewModel
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject

/**
 * A view model that handles credential provider operations for [CredentialProviderActivity].
 *
 * This ViewModel processes credential-related intents and sets the pending credential request
 * on [CredentialProviderRequestManager] for relay to [MainViewModel]. This ensures credential
 * data is never passed through intent extras to exported activities, providing security
 * hardening against malicious intent attacks.
 *
 * Since [CredentialProviderActivity] is a transparent trampoline with no UI, this ViewModel only
 * handles intent processing. All UI state management (theme, feature flags, auth flows) is
 * handled by [MainActivity].
 *
 * @see RootNavViewModel for navigation based on SpecialCircumstance.
 */
@HiltViewModel
class CredentialProviderViewModel @Inject constructor(
    private val credentialProviderRequestManager: CredentialProviderRequestManager,
    private val authRepository: AuthRepository,
    private val vowkeyCredentialManager: VowkeyCredentialManager,
) : BaseViewModel<Unit, Unit, CredentialProviderAction>(initialState = Unit) {

    override fun handleAction(action: CredentialProviderAction) {
        when (action) {
            is CredentialProviderAction.ReceiveFirstIntent -> handleIntent(action.intent)
            is CredentialProviderAction.ReceiveNewIntent -> handleIntent(action.intent)
        }
    }

    private fun handleIntent(intent: Intent) {
        intent.getCreateCredentialRequestOrNull()?.let { handleCreateCredential(it) }
            ?: intent.getFido2AssertionRequestOrNull()?.let { handleFido2Assertion(it) }
            ?: intent.getProviderGetPasswordRequestOrNull()?.let { handlePasswordGet(it) }
            ?: intent.getGetCredentialsRequestOrNull()?.let { handleGetCredentials(it) }
    }

    private fun handleCreateCredential(request: CreateCredentialRequest) {
        vowkeyCredentialManager.isUserVerified = request.isUserPreVerified

        // Switch accounts if the selected user is not the active user
        if (authRepository.activeUserId != null &&
            authRepository.activeUserId != request.userId
        ) {
            authRepository.switchAccount(request.userId)
        }

        credentialProviderRequestManager.setPendingCredentialRequest(
            CredentialProviderRequest.CreateCredential(request),
        )
    }

    private fun handleFido2Assertion(request: Fido2CredentialAssertionRequest) {
        // Set the user's verification status when a new FIDO 2 request is received
        vowkeyCredentialManager.isUserVerified = request.isUserPreVerified

        credentialProviderRequestManager.setPendingCredentialRequest(
            CredentialProviderRequest.Fido2Assertion(request),
        )
    }

    private fun handlePasswordGet(request: ProviderGetPasswordCredentialRequest) {
        // Set the user's verification status when a new GetPassword request is received
        vowkeyCredentialManager.isUserVerified = request.isUserPreVerified

        credentialProviderRequestManager.setPendingCredentialRequest(
            CredentialProviderRequest.GetPassword(request),
        )
    }

    private fun handleGetCredentials(request: GetCredentialsRequest) {
        credentialProviderRequestManager.setPendingCredentialRequest(
            CredentialProviderRequest.GetCredentials(request),
        )
    }
}

/**
 * Models actions for the [CredentialProviderViewModel].
 */
sealed class CredentialProviderAction {

    /**
     * Receive the first intent when the activity is created.
     */
    data class ReceiveFirstIntent(val intent: Intent) : CredentialProviderAction()

    /**
     * Receive a new intent when the activity receives onNewIntent.
     */
    data class ReceiveNewIntent(val intent: Intent) : CredentialProviderAction()
}
