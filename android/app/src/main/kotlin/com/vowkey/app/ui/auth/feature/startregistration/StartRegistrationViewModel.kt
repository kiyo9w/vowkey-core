package com.vowkey.app.ui.auth.feature.startregistration

import android.net.Uri
import android.os.Parcelable
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.data.datasource.disk.model.ServerConfig
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.model.Environment
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.ui.platform.base.BackgroundEvent
import com.vowkey.ui.platform.base.BaseViewModel
import com.vowkey.ui.platform.base.util.isValidEmail
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.manager.intent.model.AuthTabData
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManager
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.model.LoginResult
import com.vowkey.app.data.auth.repository.model.PrevalidateSsoResult
import com.vowkey.app.data.auth.repository.model.RegisterResult
import com.vowkey.app.data.auth.repository.model.SendVerificationEmailResult
import com.vowkey.app.data.auth.repository.util.SsoCallbackResult
import com.vowkey.app.data.auth.repository.util.generateUriForSso
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManager
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.app.data.platform.util.ssoAuthTabData
import com.vowkey.app.data.tools.generator.repository.GeneratorRepository
import com.vowkey.app.data.tools.generator.repository.utils.generateRandomString
import com.vowkey.app.ui.platform.model.SnackbarRelay
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.toImmutableList
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.parcelize.Parcelize
import javax.inject.Inject

private const val KEY_STATE = "state"
private const val KEY_REG_SOCIAL_SSO = "startRegSocialSso"
private const val SSO_RANDOM_LENGTH = 64

/**
 * Models logic for the start registration screen.
 */
@Suppress("TooManyFunctions", "LongParameterList")
@HiltViewModel
class StartRegistrationViewModel @Inject constructor(
    private val savedStateHandle: SavedStateHandle,
    snackbarRelayManager: SnackbarRelayManager<SnackbarRelay>,
    serverConfigRepository: ServerConfigRepository,
    featureFlagManager: FeatureFlagManager,
    private val authRepository: AuthRepository,
    private val environmentRepository: EnvironmentRepository,
    private val generatorRepository: GeneratorRepository,
    private val networkConnectionManager: NetworkConnectionManager,
) : BaseViewModel<StartRegistrationState, StartRegistrationEvent, StartRegistrationAction>(
    initialState = savedStateHandle[KEY_STATE] ?: run {
        val environmentType = environmentRepository.environment.type
        StartRegistrationState(
            emailInput = "",
            nameInput = "",
            isReceiveMarketingEmailsToggled = false,
            isContinueButtonEnabled = false,
            selectedEnvironmentType = environmentType,
            dialog = null,
            isSocialLoginEnabled = featureFlagManager.getFeatureFlag(FlagKey.SocialLogin),
        )
    },
) {

    init {
        // As state updates, write to saved state handle:
        stateFlow
            .onEach { savedStateHandle[KEY_STATE] = it }
            .launchIn(viewModelScope)

        // Listen for changes in environment triggered both by this VM and externally.
        environmentRepository
            .environmentStateFlow
            .map { StartRegistrationAction.Internal.UpdatedEnvironmentReceive(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)
        snackbarRelayManager
            .getSnackbarDataFlow(SnackbarRelay.ENVIRONMENT_SAVED)
            .map { StartRegistrationAction.Internal.SnackbarDataReceived(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)
        serverConfigRepository
            .serverConfigStateFlow
            .map { StartRegistrationAction.Internal.ServerConfigReceived(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)
        featureFlagManager
            .getFeatureFlagFlow(FlagKey.SocialLogin)
            .map { StartRegistrationAction.Internal.SocialLoginFeatureUpdated(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)
        authRepository.ssoCallbackResultFlow
            .onEach { sendAction(StartRegistrationAction.Internal.ReceiveSsoCallback(it)) }
            .launchIn(viewModelScope)
    }

    override fun handleAction(action: StartRegistrationAction) {
        when (action) {
            is StartRegistrationAction.ContinueClick -> handleContinueClick()
            is StartRegistrationAction.SocialSignInClick -> handleSocialSignInClicked(action.provider)
            is StartRegistrationAction.EmailInputChange -> handleEmailInputChanged(action)
            is StartRegistrationAction.NameInputChange -> handleNameInputChanged(action)
            is StartRegistrationAction.CloseClick -> handleCloseClick()
            is StartRegistrationAction.ErrorDialogDismiss -> handleDialogDismiss()
            is StartRegistrationAction.ReceiveMarketingEmailsToggle -> {
                handleReceiveMarketingEmailsToggle(action)
            }

            is StartRegistrationAction.PrivacyPolicyClick -> handlePrivacyPolicyClick()
            is StartRegistrationAction.TermsClick -> handleTermsClick()
            is StartRegistrationAction.UnsubscribeMarketingEmailsClick -> {
                handleUnsubscribeMarketingEmailsClick()
            }

            is StartRegistrationAction.EnvironmentTypeSelect -> handleEnvironmentTypeSelect(action)
            StartRegistrationAction.ServerGeologyHelpClick -> handleServerGeologyHelpClick()
            is StartRegistrationAction.Internal -> handleInternalAction(action)
        }
    }

    private fun handleInternalAction(action: StartRegistrationAction.Internal) {
        when (action) {
            is StartRegistrationAction.Internal.ReceiveSendVerificationEmailResult -> {
                handleReceiveSendVerificationEmailResult(action)
            }

            is StartRegistrationAction.Internal.SnackbarDataReceived -> {
                handleSnackbarDataReceived(action)
            }

            is StartRegistrationAction.Internal.UpdatedEnvironmentReceive -> {
                handleUpdatedEnvironmentReceive(action)
            }

            is StartRegistrationAction.Internal.ServerConfigReceived -> {
                handleServerConfigReceived(action)
            }

            is StartRegistrationAction.Internal.SocialLoginFeatureUpdated -> {
                mutableStateFlow.update { it.copy(isSocialLoginEnabled = action.isEnabled) }
            }

            is StartRegistrationAction.Internal.ReceiveSsoPrevalidation -> viewModelScope.launch {
                handleSsoPrevalidation(action.provider, action.result)
            }

            is StartRegistrationAction.Internal.ReceiveSsoCallback -> {
                handleSsoCallback(action.result)
            }

            is StartRegistrationAction.Internal.ReceiveSocialLoginResult -> {
                handleReceiveSocialLoginResult(action.provider, action.loginResult)
            }
        }
    }

    private fun handleServerGeologyHelpClick() {
        sendEvent(StartRegistrationEvent.NavigateToServerSelectionInfo)
    }

    private fun handleEnvironmentTypeSelect(action: StartRegistrationAction.EnvironmentTypeSelect) {
        val environment = when (action.environmentType) {
            Environment.Type.US -> Environment.Prod.Us
            Environment.Type.EU -> Environment.Prod.Eu
            Environment.Type.SELF_HOSTED -> {
                // Launch the self-hosted screen and select the full environment details there.
                sendEvent(StartRegistrationEvent.NavigateToEnvironment)
                return
            }

            Environment.Type.FED_RAMP -> {
                // New account creation is not supported with FedRAMP.
                return
            }
        }

        // Update the environment in the repo; the VM state will update accordingly because it is
        // listening for changes.
        environmentRepository.environment = environment
    }

    private fun handleSnackbarDataReceived(
        action: StartRegistrationAction.Internal.SnackbarDataReceived,
    ) {
        sendEvent(StartRegistrationEvent.ShowSnackbar(action.data))
    }

    private fun handleUpdatedEnvironmentReceive(
        action: StartRegistrationAction.Internal.UpdatedEnvironmentReceive,
    ) {
        mutableStateFlow.update {
            it.copy(
                selectedEnvironmentType = action.environment.type,
            )
        }
    }

    private fun handleServerConfigReceived(
        action: StartRegistrationAction.Internal.ServerConfigReceived,
    ) {
        val serverData = action.serverConfig?.serverData ?: return
        if (serverData.settings?.disableUserRegistration == true) {
            // Show the dialog informing the user that they cannot create an account.
            mutableStateFlow.update {
                it.copy(
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.account_creation_restricted.asText(),
                        message = VowkeyString
                            .only_allows_invited_users_to_create_accounts
                            .asText(serverData.environment?.vaultUrl.orEmpty()),
                    ),
                )
            }
        }
    }

    private fun handlePrivacyPolicyClick() =
        sendEvent(StartRegistrationEvent.NavigateToPrivacyPolicy)

    private fun handleTermsClick() = sendEvent(StartRegistrationEvent.NavigateToTerms)

    private fun handleUnsubscribeMarketingEmailsClick() =
        sendEvent(StartRegistrationEvent.NavigateToUnsubscribe)

    private fun handleReceiveMarketingEmailsToggle(
        action: StartRegistrationAction.ReceiveMarketingEmailsToggle,
    ) {
        mutableStateFlow.update {
            it.copy(isReceiveMarketingEmailsToggled = action.newState)
        }
    }

    private fun handleDialogDismiss() {
        mutableStateFlow.update {
            it.copy(dialog = null)
        }
    }

    private fun handleCloseClick() {
        sendEvent(StartRegistrationEvent.NavigateBack)
    }

    private fun handleEmailInputChanged(action: StartRegistrationAction.EmailInputChange) {
        mutableStateFlow.update {
            it.copy(
                emailInput = action.input,
                isContinueButtonEnabled = action.input.isNotBlank(),
            )
        }
    }

    private fun handleNameInputChanged(action: StartRegistrationAction.NameInputChange) {
        mutableStateFlow.update {
            it.copy(
                nameInput = action.input,
                isContinueButtonEnabled = state.emailInput.isNotBlank(),
            )
        }
    }

    private fun handleContinueClick() = when {
        state.emailInput.isBlank() -> {
            mutableStateFlow.update {
                it.copy(
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = VowkeyString.validation_field_required
                            .asText(VowkeyString.email_address.asText()),
                    ),
                )
            }
        }

        !state.emailInput.isValidEmail() -> {
            mutableStateFlow.update {
                it.copy(
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = VowkeyString.invalid_email.asText(),
                    ),
                )
            }
        }

        else -> {
            submitSendVerificationEmailRequest()
        }
    }

    private fun submitSendVerificationEmailRequest() {
        mutableStateFlow.update {
            it.copy(dialog = StartRegistrationDialog.Loading)
        }
        viewModelScope.launch {
            val result = authRepository.sendVerificationEmail(
                email = state.emailInput,
                name = state.nameInput,
                receiveMarketingEmails = state.isReceiveMarketingEmailsToggled,
            )
            sendAction(
                StartRegistrationAction.Internal.ReceiveSendVerificationEmailResult(
                    sendVerificationEmailResult = result,
                ),
            )
        }
    }

    private fun handleReceiveSendVerificationEmailResult(
        result: StartRegistrationAction.Internal.ReceiveSendVerificationEmailResult,
    ) {
        when (val sendVerificationEmailResult = result.sendVerificationEmailResult) {
            is SendVerificationEmailResult.Error -> {
                mutableStateFlow.update {
                    it.copy(
                        dialog = StartRegistrationDialog.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = sendVerificationEmailResult
                                .errorMessage
                                ?.asText()
                                ?: VowkeyString.generic_error_message.asText(),
                            error = sendVerificationEmailResult.error,
                        ),
                    )
                }
            }

            is SendVerificationEmailResult.Success -> {
                environmentRepository.saveCurrentEnvironmentForEmail(state.emailInput)
                mutableStateFlow.update { it.copy(dialog = null) }
                if (sendVerificationEmailResult.emailVerificationToken == null) {
                    sendEvent(
                        StartRegistrationEvent.NavigateToCheckEmail(
                            email = state.emailInput,
                        ),
                    )
                } else {
                    sendEvent(
                        StartRegistrationEvent.NavigateToCompleteRegistration(
                            email = state.emailInput,
                            verificationToken = sendVerificationEmailResult.emailVerificationToken,
                        ),
                    )
                }
            }
        }
    }

    private fun handleSocialSignInClicked(provider: String) {
        if (!networkConnectionManager.isNetworkConnected) {
            mutableStateFlow.update {
                it.copy(
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.internet_connection_required_title.asText(),
                        message = VowkeyString.internet_connection_required_message.asText(),
                    ),
                )
            }
            return
        }
        mutableStateFlow.update { it.copy(dialog = StartRegistrationDialog.Loading) }
        viewModelScope.launch {
            sendAction(
                StartRegistrationAction.Internal.ReceiveSsoPrevalidation(
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
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = failure.message?.asText() ?: VowkeyString.login_sso_error.asText(),
                        error = failure.error,
                    ),
                )
            }
            return
        }
        val codeVerifier = generatorRepository.generateRandomString(SSO_RANDOM_LENGTH)
        val ssoState = "${generatorRepository.generateRandomString(SSO_RANDOM_LENGTH)}_identifier=$provider"
        val environment = environmentRepository.environment
        val authTabData = environment.ssoAuthTabData
        savedStateHandle[KEY_REG_SOCIAL_SSO] = StartRegSocialSsoData(
            provider = provider,
            redirectUri = authTabData.callbackUrl,
            state = ssoState,
            codeVerifier = codeVerifier,
        )
        sendEvent(
            StartRegistrationEvent.NavigateToSocialSignIn(
                uri = generateUriForSso(
                    identityBaseUrl = environment.baseIdentityUrl,
                    redirectUrl = authTabData.callbackUrl,
                    organizationIdentifier = provider,
                    token = token,
                    state = ssoState,
                    codeVerifier = codeVerifier,
                    provider = provider,
                ),
                authTabData = authTabData,
            ),
        )
        mutableStateFlow.update { it.copy(dialog = null) }
    }

    private fun handleSsoCallback(result: SsoCallbackResult) {
        val saved = savedStateHandle.get<StartRegSocialSsoData>(KEY_REG_SOCIAL_SSO) ?: return
        savedStateHandle[KEY_REG_SOCIAL_SSO] = null
        if (result is SsoCallbackResult.MissingCode) {
            mutableStateFlow.update { it.copy(dialog = null) }
            return
        }
        if (result !is SsoCallbackResult.Success || result.state != saved.state) {
            mutableStateFlow.update {
                it.copy(
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = VowkeyString.login_sso_error.asText(),
                    ),
                )
            }
            return
        }
        mutableStateFlow.update { it.copy(dialog = StartRegistrationDialog.Loading) }
        viewModelScope.launch {
            val loginResult = authRepository.login(
                email = state.emailInput.trim(),
                ssoCode = result.code,
                ssoCodeVerifier = saved.codeVerifier,
                ssoRedirectUri = saved.redirectUri,
                organizationIdentifier = saved.provider,
            )
            sendAction(
                StartRegistrationAction.Internal.ReceiveSocialLoginResult(
                    provider = saved.provider,
                    loginResult = loginResult,
                ),
            )
        }
    }

    private fun handleReceiveSocialLoginResult(provider: String, loginResult: LoginResult) {
        when (loginResult) {
            is LoginResult.Success -> {
                mutableStateFlow.update { it.copy(dialog = null) }
            }
            is LoginResult.TwoFactorRequired,
            is LoginResult.NewDeviceVerification,
            -> {
                mutableStateFlow.update { it.copy(dialog = null) }
                sendEvent(
                    StartRegistrationEvent.NavigateToTwoFactorLogin(
                        emailAddress = state.emailInput.trim(),
                        orgIdentifier = provider,
                    ),
                )
            }
            is LoginResult.Error -> {
                mutableStateFlow.update {
                    it.copy(
                        dialog = StartRegistrationDialog.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = loginResult.errorMessage?.asText()
                                ?: VowkeyString.login_sso_error.asText(),
                            error = loginResult.error,
                        ),
                    )
                }
            }
            else -> {
                mutableStateFlow.update {
                    it.copy(
                        dialog = StartRegistrationDialog.Error(
                            title = VowkeyString.an_error_has_occurred.asText(),
                            message = VowkeyString.login_sso_error.asText(),
                        ),
                    )
                }
            }
        }
    }
}

/**
 * UI state for the start registration screen.
 */
@Parcelize
data class StartRegistrationState(
    val emailInput: String,
    val nameInput: String,
    val isReceiveMarketingEmailsToggled: Boolean,
    val isContinueButtonEnabled: Boolean,
    val selectedEnvironmentType: Environment.Type,
    val dialog: StartRegistrationDialog?,
    val isSocialLoginEnabled: Boolean = false,
) : Parcelable {
    /**
     * The selectable environments.
     */
    val environmentTypeOptions: ImmutableList<Environment.Type>
        get() = Environment.Type
            .entries
            .filterNot { it == Environment.Type.FED_RAMP }
            .toImmutableList()
}

/**
 * Models dialogs that can be displayed on the start registration screen.
 */
sealed class StartRegistrationDialog : Parcelable {
    /**
     * Loading dialog.
     */
    @Parcelize
    data object Loading : StartRegistrationDialog()

    /**
     * General error dialog with an OK button.
     */
    @Parcelize
    data class Error(
        val title: Text?,
        val message: Text,
        val error: Throwable? = null,
    ) : StartRegistrationDialog()
}

/**
 * Models events for the start registration screen.
 */
sealed class StartRegistrationEvent {

    /**
     * Navigate back to previous screen.
     */
    data object NavigateBack : StartRegistrationEvent()

    /**
     * Navigates to the complete registration screen.
     */
    data class NavigateToCompleteRegistration(
        val email: String,
        val verificationToken: String,
    ) : StartRegistrationEvent()

    /**
     * Navigates to the check email screen.
     */
    data class NavigateToCheckEmail(
        val email: String,
    ) : StartRegistrationEvent()

    /**
     * Navigate to terms and conditions.
     */
    data object NavigateToTerms : StartRegistrationEvent()

    /**
     * Navigate to privacy policy.
     */
    data object NavigateToPrivacyPolicy : StartRegistrationEvent()

    /**
     * Navigate to unsubscribe to marketing emails.
     */
    data object NavigateToUnsubscribe : StartRegistrationEvent()

    /**
     * Navigates to the self-hosted/custom environment screen.
     */
    data object NavigateToEnvironment : StartRegistrationEvent()

    /**
     * Navigates to the server selection info.
     */
    data object NavigateToServerSelectionInfo : StartRegistrationEvent()

    data class NavigateToSocialSignIn(
        val uri: Uri,
        val authTabData: AuthTabData,
    ) : StartRegistrationEvent()

    data class NavigateToTwoFactorLogin(
        val emailAddress: String,
        val orgIdentifier: String?,
    ) : StartRegistrationEvent()

    /**
     * Show a snackbar with the given [data].
     */
    data class ShowSnackbar(
        val data: VowkeySnackbarData,
    ) : StartRegistrationEvent(), BackgroundEvent
}

/**
 * Models actions for the start registration screen.
 */
sealed class StartRegistrationAction {
    /**
     * User clicked continue.
     */
    data object ContinueClick : StartRegistrationAction()

    data class SocialSignInClick(val provider: String) : StartRegistrationAction()

    /**
     * Indicates that the top-bar close button was clicked.
     */
    data object CloseClick : StartRegistrationAction()

    /**
     * Email input changed.
     */
    data class EmailInputChange(val input: String) : StartRegistrationAction()

    /**
     * Name input changed.
     */
    data class NameInputChange(val input: String) : StartRegistrationAction()

    /**
     * Indicates that the selection from the region drop down has changed.
     */
    data class EnvironmentTypeSelect(
        val environmentType: Environment.Type,
    ) : StartRegistrationAction()

    /**
     * User dismissed the error dialog.
     */
    data object ErrorDialogDismiss : StartRegistrationAction()

    /**
     * User tapped receive marketing emails toggle.
     */
    data class ReceiveMarketingEmailsToggle(val newState: Boolean) : StartRegistrationAction()

    /**
     * User tapped privacy policy link.
     */
    data object PrivacyPolicyClick : StartRegistrationAction()

    /**
     * User tapped terms link.
     */
    data object TermsClick : StartRegistrationAction()

    /**
     * User tapped the unsubscribe link.
     */
    data object UnsubscribeMarketingEmailsClick : StartRegistrationAction()

    /**
     * User has tapped the tooltip for the server environment
     */
    data object ServerGeologyHelpClick : StartRegistrationAction()

    /**
     * Models actions that the [StartRegistrationViewModel] itself might send.
     */
    sealed class Internal : StartRegistrationAction() {
        /**
         * Indicates a [RegisterResult] has been received.
         */
        data class ReceiveSendVerificationEmailResult(
            val sendVerificationEmailResult: SendVerificationEmailResult,
        ) : Internal()

        /**
         * Indicates that snackbar data has been received.
         */
        data class SnackbarDataReceived(
            val data: VowkeySnackbarData,
        ) : Internal()

        /**
         * Indicates that there has been a change in [environment].
         */
        data class UpdatedEnvironmentReceive(
            val environment: Environment,
        ) : Internal()

        /**
         * Indicates that an updated [serverConfig] has been received.
         */
        data class ServerConfigReceived(
            val serverConfig: ServerConfig?,
        ) : Internal()

        data class SocialLoginFeatureUpdated(
            val isEnabled: Boolean,
        ) : Internal()

        data class ReceiveSsoPrevalidation(
            val provider: String,
            val result: PrevalidateSsoResult,
        ) : Internal()

        data class ReceiveSsoCallback(
            val result: SsoCallbackResult,
        ) : Internal()

        data class ReceiveSocialLoginResult(
            val provider: String,
            val loginResult: LoginResult,
        ) : Internal()
    }
}

@Parcelize
private data class StartRegSocialSsoData(
    val provider: String,
    val redirectUri: String,
    val state: String,
    val codeVerifier: String,
) : Parcelable
