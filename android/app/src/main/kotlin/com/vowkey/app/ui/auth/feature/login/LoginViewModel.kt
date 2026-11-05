@file:Suppress("TooManyFunctions")

package com.vowkey.app.ui.auth.feature.login

import android.os.Parcelable
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.data.repository.util.baseWebVaultUrlOrDefault
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.ui.platform.base.BaseViewModel
import com.vowkey.ui.platform.components.account.model.AccountSummary
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.model.KnownDeviceResult
import com.vowkey.app.data.auth.repository.model.LoginResult
import com.vowkey.app.data.auth.repository.model.LogoutReason
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.app.data.auth.repository.model.PrevalidateSsoResult
import com.vowkey.app.data.auth.repository.util.SsoCallbackResult
import com.vowkey.app.data.auth.repository.util.generateUriForSso
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManager
import com.vowkey.app.data.platform.util.ssoAuthTabData
import com.vowkey.app.data.tools.generator.repository.GeneratorRepository
import com.vowkey.app.data.tools.generator.repository.utils.generateRandomString
import com.vowkey.app.data.platform.util.toUriOrNull
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.ui.vault.feature.vault.util.toAccountSummaries
import dagger.hilt.android.lifecycle.HiltViewModel
import com.vowkey.ui.platform.manager.intent.model.AuthTabData
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.toImmutableList
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.parcelize.IgnoredOnParcel
import kotlinx.parcelize.Parcelize
import javax.inject.Inject
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach

private const val KEY_STATE = "state"
private const val KEY_SOCIAL_SSO = "socialSso"
private const val APPLE_PROVIDER = "apple"
private const val SSO_RANDOM_LENGTH = 64

/**
 * Manages application state for the initial login screen.
 */
@Suppress("LongParameterList")
@HiltViewModel
class LoginViewModel @Inject constructor(
    private val savedStateHandle: SavedStateHandle,
    private val environmentRepository: EnvironmentRepository,
    private val authRepository: AuthRepository,
    private val vaultRepository: VaultRepository,
    private val generatorRepository: GeneratorRepository,
    private val networkConnectionManager: NetworkConnectionManager,
    featureFlagManager: FeatureFlagManager,
) : BaseViewModel<LoginState, LoginEvent, LoginAction>(
    // We load the state from the savedStateHandle for testing purposes.
    initialState = savedStateHandle[KEY_STATE]
        ?: run {
            val args = savedStateHandle.toLoginArgs()
            LoginState(
                emailAddress = args.emailAddress,
                isLoginButtonEnabled = false,
                passwordInput = "",
                environmentLabel = environmentRepository.environment.label,
                dialogState = LoginState.DialogState.Loading(VowkeyString.loading.asText()),
                accountSummaries = authRepository
                    .userStateFlow
                    .value
                    ?.toAccountSummaries()
                    .orEmpty()
                    .toImmutableList(),
                shouldShowLoginWithDevice = false,
                isSocialLoginEnabled = featureFlagManager.getFeatureFlag(FlagKey.SocialLogin),
            )
        },
) {

    init {
        authRepository.ssoCallbackResultFlow
            .onEach { sendAction(LoginAction.Internal.ReceiveSsoCallback(it)) }
            .launchIn(viewModelScope)
        featureFlagManager
            .getFeatureFlagFlow(FlagKey.SocialLogin)
            .map { LoginAction.Internal.SocialLoginFeatureUpdated(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)
        viewModelScope.launch {
            trySendAction(
                LoginAction.Internal.ReceiveKnownDeviceResult(
                    knownDeviceResult = authRepository.getIsKnownDevice(state.emailAddress),
                ),
            )
        }
    }

    override fun handleAction(action: LoginAction) {
        when (action) {
            LoginAction.AddAccountClick -> handleAddAccountClicked()
            is LoginAction.LockAccountClick -> handleLockAccountClicked(action)
            is LoginAction.LogoutAccountClick -> handleLogoutAccountClicked(action)
            is LoginAction.SwitchAccountClick -> handleSwitchAccountClicked(action)
            is LoginAction.CloseButtonClick -> handleCloseButtonClicked()
            LoginAction.LoginButtonClick -> handleLoginButtonClicked()
            LoginAction.LoginWithDeviceButtonClick -> handleLoginWithDeviceButtonClicked()
            LoginAction.MasterPasswordHintClick -> handleMasterPasswordHintClicked()
            LoginAction.NotYouButtonClick -> handleNotYouButtonClicked()
            LoginAction.SingleSignOnClick -> handleSingleSignOnClicked()
            LoginAction.AppleClick -> handleSocialSignInClicked(APPLE_PROVIDER)
            is LoginAction.SocialSignInClick -> handleSocialSignInClicked(action.provider)
            is LoginAction.PasswordInputChanged -> handlePasswordInputChanged(action)
            is LoginAction.ErrorDialogDismiss -> handleErrorDialogDismiss()

            is LoginAction.Internal.ReceiveLoginResult -> {
                handleReceiveLoginResult(action = action)
            }

            is LoginAction.Internal.ReceiveKnownDeviceResult -> {
                handleKnownDeviceResultReceived(action)
            }
            is LoginAction.Internal.ReceiveSsoCallback -> handleSsoCallback(action.result)
            is LoginAction.Internal.ReceiveSsoPrevalidation -> viewModelScope.launch {
                handleSsoPrevalidation(action.provider, action.result)
            }
            is LoginAction.Internal.SocialLoginFeatureUpdated -> {
                mutableStateFlow.update { it.copy(isSocialLoginEnabled = action.isEnabled) }
            }
        }
    }

    private fun handleAddAccountClicked() {
        // Since we are already in the login flow we can just go back to the Landing Screen
        sendEvent(LoginEvent.NavigateBack)
    }

    private fun handleLockAccountClicked(action: LoginAction.LockAccountClick) {
        vaultRepository.lockVault(userId = action.accountSummary.userId, isUserInitiated = true)
    }

    private fun handleLogoutAccountClicked(action: LoginAction.LogoutAccountClick) {
        authRepository.logout(
            userId = action.accountSummary.userId,
            reason = LogoutReason.Click(source = "LoginViewModel"),
        )
    }

    private fun handleSwitchAccountClicked(action: LoginAction.SwitchAccountClick) {
        authRepository.switchAccount(userId = action.accountSummary.userId)
    }

    private fun handleKnownDeviceResultReceived(
        action: LoginAction.Internal.ReceiveKnownDeviceResult,
    ) {
        when (action.knownDeviceResult) {
            is KnownDeviceResult.Success -> {
                mutableStateFlow.update {
                    it.copy(
                        dialogState = null,
                        shouldShowLoginWithDevice = action.knownDeviceResult.isKnownDevice,
                    )
                }
            }

            is KnownDeviceResult.Error -> {
                mutableStateFlow.update {
                    it.copy(
                        dialogState = null,
                        shouldShowLoginWithDevice = false,
                    )
                }
            }
        }
    }

    @Suppress("MaxLineLength", "LongMethod")
    private fun handleReceiveLoginResult(action: LoginAction.Internal.ReceiveLoginResult) {
        when (val loginResult = action.loginResult) {
            is LoginResult.EncryptionKeyMigrationRequired -> {
                val vaultUrl = environmentRepository.environment.baseWebVaultUrlOrDefault

                mutableStateFlow.update {
                    it.copy(
                        dialogState = LoginState.DialogState.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = VowkeyString
                                .this_account_will_soon_be_deleted_log_in_at_x_to_continue_using_vowkey
                                .asText(vaultUrl.toUriOrNull()?.host ?: vaultUrl),
                        ),
                    )
                }
            }

            is LoginResult.TwoFactorRequired -> {
                mutableStateFlow.update { it.copy(dialogState = null) }
                sendEvent(
                    LoginEvent.NavigateToTwoFactorLogin(
                        emailAddress = state.emailAddress,
                        password = state.passwordInput,
                    ),
                )
            }

            // NO-OP: This result should not be possible here
            is LoginResult.ConfirmKeyConnectorDomain -> Unit

            is LoginResult.Error -> {
                mutableStateFlow.update {
                    it.copy(
                        dialogState = LoginState.DialogState.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = loginResult.errorMessage?.asText()
                                ?: VowkeyString.generic_error_message.asText(),
                            error = loginResult.error,
                        ),
                    )
                }
            }

            LoginResult.UnofficialServerError -> {
                mutableStateFlow.update {
                    it.copy(
                        dialogState = LoginState.DialogState.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = VowkeyString.this_is_not_a_recognized_vowkey_server_you_may_need_to_check_with_your_provider_or_update_your_server.asText(),
                        ),
                    )
                }
            }

            is LoginResult.Success -> {
                mutableStateFlow.update { it.copy(dialogState = null) }
            }

            LoginResult.CertificateError -> {
                mutableStateFlow.update {
                    it.copy(
                        dialogState = LoginState.DialogState.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = VowkeyString.we_couldnt_verify_the_servers_certificate.asText(),
                        ),
                    )
                }
            }

            is LoginResult.NewDeviceVerification -> {
                mutableStateFlow.update { it.copy(dialogState = null) }
                sendEvent(
                    LoginEvent.NavigateToTwoFactorLogin(
                        emailAddress = state.emailAddress,
                        password = state.passwordInput,
                        isNewDeviceVerification = true,
                    ),
                )
            }
        }
    }

    private fun handleErrorDialogDismiss() {
        mutableStateFlow.update { it.copy(dialogState = null) }
    }

    private fun handleCloseButtonClicked() {
        sendEvent(LoginEvent.NavigateBack)
    }

    private fun handleLoginButtonClicked() {
        attemptLogin()
    }

    private fun handleLoginWithDeviceButtonClicked() {
        sendEvent(LoginEvent.NavigateToLoginWithDevice(state.emailAddress))
    }

    private fun attemptLogin() {
        mutableStateFlow.update {
            it.copy(
                dialogState = LoginState.DialogState.Loading(
                    message = VowkeyString.logging_in.asText(),
                ),
            )
        }
        viewModelScope.launch {
            val result = authRepository.login(
                email = state.emailAddress,
                password = state.passwordInput,
            )
            sendAction(
                LoginAction.Internal.ReceiveLoginResult(
                    loginResult = result,
                ),
            )
        }
    }

    private fun handleMasterPasswordHintClicked() {
        val email = state.emailAddress
        sendEvent(LoginEvent.NavigateToMasterPasswordHint(email))
    }

    private fun handleNotYouButtonClicked() {
        sendEvent(LoginEvent.NavigateBack)
    }

    private fun handleSingleSignOnClicked() {
        val email = state.emailAddress
        sendEvent(LoginEvent.NavigateToEnterpriseSignOn(email))
    }

    private fun handleSocialSignInClicked(provider: String) {
        if (!networkConnectionManager.isNetworkConnected) {
            mutableStateFlow.update {
                it.copy(
                    dialogState = LoginState.DialogState.Error(
                        title = VowkeyString.internet_connection_required_title.asText(),
                        message = VowkeyString.internet_connection_required_message.asText(),
                    ),
                )
            }
            return
        }
        mutableStateFlow.update {
            it.copy(dialogState = LoginState.DialogState.Loading(VowkeyString.logging_in.asText()))
        }
        viewModelScope.launch {
            sendAction(
                LoginAction.Internal.ReceiveSsoPrevalidation(
                    provider = provider,
                    result = authRepository.prevalidateSso(provider),
                ),
            )
        }
    }

    private suspend fun handleSsoPrevalidation(provider: String, result: PrevalidateSsoResult) {
        val token = (result as? PrevalidateSsoResult.Success)?.token
        if (token == null) {
            val failure = result as PrevalidateSsoResult.Failure
            mutableStateFlow.update {
                it.copy(
                    dialogState = LoginState.DialogState.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = failure.message?.asText() ?: VowkeyString.login_sso_error.asText(),
                        error = failure.error,
                    ),
                )
            }
            return
        }
        val codeVerifier = generatorRepository.generateRandomString(SSO_RANDOM_LENGTH)
        val state = "${generatorRepository.generateRandomString(SSO_RANDOM_LENGTH)}_identifier=$provider"
        val environment = environmentRepository.environment
        val authTabData = environment.ssoAuthTabData
        savedStateHandle[KEY_SOCIAL_SSO] = SocialSsoData(provider, authTabData.callbackUrl, state, codeVerifier)
        sendEvent(
            LoginEvent.NavigateToSocialSignIn(
                uri = generateUriForSso(
                    identityBaseUrl = environment.baseIdentityUrl,
                    redirectUrl = authTabData.callbackUrl,
                    organizationIdentifier = provider,
                    token = token,
                    state = state,
                    codeVerifier = codeVerifier,
                    provider = provider,
                ),
                authTabData = authTabData,
            ),
        )
        mutableStateFlow.update { it.copy(dialogState = null) }
    }

    private fun handleSsoCallback(result: SsoCallbackResult) {
        val saved = savedStateHandle.get<SocialSsoData>(KEY_SOCIAL_SSO) ?: return
        savedStateHandle[KEY_SOCIAL_SSO] = null
        if (result is SsoCallbackResult.MissingCode) {
            mutableStateFlow.update { it.copy(dialogState = null) }
            return
        }
        if (result !is SsoCallbackResult.Success || result.state != saved.state) {
            mutableStateFlow.update {
                it.copy(
                    dialogState = LoginState.DialogState.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = VowkeyString.login_sso_error.asText(),
                    ),
                )
            }
            return
        }
        mutableStateFlow.update {
            it.copy(dialogState = LoginState.DialogState.Loading(VowkeyString.logging_in.asText()))
        }
        viewModelScope.launch {
            val loginResult = authRepository.login(
                email = state.emailAddress,
                ssoCode = result.code,
                ssoCodeVerifier = saved.codeVerifier,
                ssoRedirectUri = saved.redirectUri,
                organizationIdentifier = saved.provider,
            )
            sendAction(LoginAction.Internal.ReceiveLoginResult(loginResult))
        }
    }

    private fun handlePasswordInputChanged(action: LoginAction.PasswordInputChanged) {
        mutableStateFlow.update {
            it.copy(
                passwordInput = action.input,
                isLoginButtonEnabled = action.input.isNotBlank(),
            )
        }
    }
}

/**
 * Models state of the login screen.
 */
@Parcelize
data class LoginState(
    // We never want this saved since the input is sensitive data.
    @IgnoredOnParcel val passwordInput: String = "",
    val emailAddress: String,
    val environmentLabel: String,
    val isLoginButtonEnabled: Boolean,
    val dialogState: DialogState?,
    val accountSummaries: ImmutableList<AccountSummary>,
    val shouldShowLoginWithDevice: Boolean,
    val isSocialLoginEnabled: Boolean = false,
) : Parcelable {
    /**
     * Represents the current state of any dialogs on the screen.
     */
    sealed class DialogState : Parcelable {
        /**
         * Represents a dismissible dialog with the given error [message].
         */
        @Parcelize
        data class Error(
            val title: Text? = null,
            val message: Text,
            val error: Throwable? = null,
        ) : DialogState()

        /**
         * Represents a loading dialog with the given [message].
         */
        @Parcelize
        data class Loading(
            val message: Text,
        ) : DialogState()
    }
}

/**
 * Models events for the login screen.
 */
sealed class LoginEvent {
    /**
     * Navigates back to the previous screen.
     */
    data object NavigateBack : LoginEvent()

    /**
     * Navigate to the master password hit screen.
     */
    data class NavigateToMasterPasswordHint(
        val emailAddress: String,
    ) : LoginEvent()

    /**
     * Navigates to the enterprise single sign on screen.
     */
    data class NavigateToEnterpriseSignOn(val emailAddress: String) : LoginEvent()

    /**
     * Navigates to the login with device screen.
     */
    data class NavigateToLoginWithDevice(
        val emailAddress: String,
    ) : LoginEvent()

    /**
     * Navigates to the two-factor login screen.
     */
    data class NavigateToTwoFactorLogin(
        val emailAddress: String,
        val password: String?,
        val isNewDeviceVerification: Boolean = false,
    ) : LoginEvent()
    /**
     * Opens the identity provider in the browser for social sign-in.
     */
    data class NavigateToSocialSignIn(
        val uri: Uri,
        val authTabData: AuthTabData,
    ) : LoginEvent()
}

/**
 * Models actions for the login screen.
 */
sealed class LoginAction {

    /**
     * The user has clicked the add account button.
     */
    data object AddAccountClick : LoginAction()

    /**
     * Indicates the user has clicked on the given [accountSummary] information in order to lock
     * the associated account's vault.
     */
    data class LockAccountClick(
        val accountSummary: AccountSummary,
    ) : LoginAction()

    /**
     * Indicates the user has clicked on the given [accountSummary] information in order to log out
     * of that account.
     */
    data class LogoutAccountClick(
        val accountSummary: AccountSummary,
    ) : LoginAction()

    /**
     * Indicates the user has clicked on the given [accountSummary] information in order to switch
     * to it.
     */
    data class SwitchAccountClick(
        val accountSummary: AccountSummary,
    ) : LoginAction()

    /**
     * Indicates that the top-bar close button was clicked.
     */
    data object CloseButtonClick : LoginAction()

    /**
     * Indicates that the Login button has been clicked.
     */
    data object LoginButtonClick : LoginAction()

    /**
     * Indicates that the Login With Device button has been clicked.
     */
    data object LoginWithDeviceButtonClick : LoginAction()

    /**
     * Indicates that the "Not you?" text was clicked.
     */
    data object NotYouButtonClick : LoginAction()

    /**
     * Indicates that the overflow option for getting a master password hint has been clicked.
     */
    data object MasterPasswordHintClick : LoginAction()

    /**
     * Indicates that the Enterprise single sign-on button has been clicked.
     */
    data object SingleSignOnClick : LoginAction()

    data object AppleClick : LoginAction()

    data class SocialSignInClick(val provider: String) : LoginAction()

    /**
     * Indicates that the error dialog has been dismissed.
     */
    data object ErrorDialogDismiss : LoginAction()

    /**
     * Indicates that the password input has changed.
     */
    data class PasswordInputChanged(val input: String) : LoginAction()

    /**
     * Models actions that the [LoginViewModel] itself might send.
     */
    sealed class Internal : LoginAction() {

        /**
         * Indicates that a [KnownDeviceResult] has been received and state should be updated.
         */
        data class ReceiveKnownDeviceResult(
            val knownDeviceResult: KnownDeviceResult,
        ) : Internal()

        /**
         * Indicates a login result has been received.
         */
        data class ReceiveLoginResult(
            val loginResult: LoginResult,
        ) : Internal()

        data class ReceiveSsoCallback(val result: SsoCallbackResult) : Internal()

        data class ReceiveSsoPrevalidation(
            val provider: String,
            val result: PrevalidateSsoResult,
        ) : Internal()

        data class SocialLoginFeatureUpdated(val isEnabled: Boolean) : Internal()
    }
}

@Parcelize
private data class SocialSsoData(
    val provider: String,
    val redirectUri: String,
    val state: String,
    val codeVerifier: String,
) : Parcelable
