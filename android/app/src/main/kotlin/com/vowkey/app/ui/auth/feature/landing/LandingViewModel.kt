package com.vowkey.app.ui.auth.feature.landing

import android.net.Uri
import android.os.Parcelable
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.viewModelScope
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.data.datasource.disk.model.ServerConfig
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.model.Environment
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.data.repository.util.baseWebVaultUrlOrDefault
import com.vowkey.ui.platform.base.BackgroundEvent
import com.vowkey.ui.platform.base.BaseViewModel
import com.vowkey.ui.platform.base.util.isValidEmail
import com.vowkey.ui.platform.components.account.model.AccountSummary
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.manager.intent.model.AuthTabData
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManager
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.model.LoginResult
import com.vowkey.app.data.auth.repository.model.LogoutReason
import com.vowkey.app.data.auth.repository.model.PrevalidateSsoResult
import com.vowkey.app.data.auth.repository.model.UserState
import com.vowkey.app.data.auth.repository.util.SsoCallbackResult
import com.vowkey.app.data.auth.repository.util.generateUriForSso
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManager
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.app.data.platform.util.ssoAuthTabData
import com.vowkey.app.data.platform.util.toUriOrNull
import com.vowkey.app.data.tools.generator.repository.GeneratorRepository
import com.vowkey.app.data.tools.generator.repository.utils.generateRandomString
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.ui.platform.model.SnackbarRelay
import com.vowkey.app.ui.vault.feature.vault.util.toAccountSummaries
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
private const val KEY_LANDING_SOCIAL_SSO = "landingSocialSso"
private const val SSO_RANDOM_LENGTH = 64

/**
 * Manages application state for the initial landing screen.
 */
@Suppress("TooManyFunctions", "LongParameterList")
@HiltViewModel
class LandingViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val vaultRepository: VaultRepository,
    private val environmentRepository: EnvironmentRepository,
    private val generatorRepository: GeneratorRepository,
    private val networkConnectionManager: NetworkConnectionManager,
    serverConfigRepository: ServerConfigRepository,
    snackbarRelayManager: SnackbarRelayManager<SnackbarRelay>,
    private val savedStateHandle: SavedStateHandle,
    featureFlagManager: FeatureFlagManager,
) : BaseViewModel<LandingState, LandingEvent, LandingAction>(
    initialState = savedStateHandle[KEY_STATE] ?: run {
        val environment = environmentRepository.environment
        val rememberedEmailAddress = authRepository.rememberedEmailAddress
        LandingState(
            emailInput = rememberedEmailAddress.orEmpty(),
            isContinueButtonEnabled = rememberedEmailAddress != null,
            isRememberEmailEnabled = rememberedEmailAddress != null,
            selectedEnvironmentType = environment.type,
            selectedEnvironmentLabel = environment.label,
            isSelectedEnvironmentFedRamp = environment.isFedRamp,
            dialog = null,
            accountSummaries = authRepository
                .userStateFlow
                .value
                ?.toAccountSummaries()
                .orEmpty()
                .toImmutableList(),
            isFedRampEnabled = featureFlagManager.getFeatureFlag(FlagKey.FedRamp),
            disableCreateAccount = serverConfigRepository
                .serverConfigStateFlow
                .value
                ?.serverData
                ?.settings
                ?.disableUserRegistration == true,
            isSocialLoginEnabled = featureFlagManager.getFeatureFlag(FlagKey.SocialLogin),
        )
    },
) {

    /**
     * Returns the [AccountSummary] from the current state that matches the current email input and
     * the current environment, or `null` if there is no match.
     */
    private val matchingAccountSummary: AccountSummary?
        get() {
            val currentEmail = state.emailInput
            val currentEnvironmentLabel = state.selectedEnvironmentLabel
            return state
                .accountSummaries
                .find { it.email == currentEmail && it.environmentLabel == currentEnvironmentLabel }
                ?.takeUnless { !it.isLoggedIn }
        }

    init {
        // As state updates:
        // - write to saved state handle
        stateFlow
            .onEach {
                savedStateHandle[KEY_STATE] = it
            }
            .launchIn(viewModelScope)

        // Listen for changes in environment triggered both by this VM and externally.
        environmentRepository
            .environmentStateFlow
            .onEach { environment ->
                sendAction(
                    LandingAction.Internal.UpdatedEnvironmentReceive(environment = environment),
                )
            }
            .launchIn(viewModelScope)

        authRepository
            .userStateFlow
            .map { userState ->
                userState?.activeAccount?.let(::mapToInternalActionOrNull)
            }
            .onEach { action ->
                action?.let(::handleAction)
            }
            .launchIn(viewModelScope)
        snackbarRelayManager
            .getSnackbarDataFlow(SnackbarRelay.ENVIRONMENT_SAVED)
            .map { LandingAction.Internal.SnackbarDataReceived(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)

        featureFlagManager
            .getFeatureFlagFlow(FlagKey.FedRamp)
            .map { LandingAction.Internal.FedRampFeatureUpdated(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)

        featureFlagManager
            .getFeatureFlagFlow(FlagKey.SocialLogin)
            .map { LandingAction.Internal.SocialLoginFeatureUpdated(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)

        authRepository.ssoCallbackResultFlow
            .onEach { sendAction(LandingAction.Internal.ReceiveSsoCallback(it)) }
            .launchIn(viewModelScope)

        serverConfigRepository
            .serverConfigStateFlow
            .map { LandingAction.Internal.ServerConfigReceived(it) }
            .onEach(::sendAction)
            .launchIn(viewModelScope)
    }

    override fun handleAction(action: LandingAction) {
        when (action) {
            is LandingAction.AppSettingsClick -> handleAppSettingsClick()
            is LandingAction.LockAccountClick -> handleLockAccountClicked(action)
            is LandingAction.LogoutAccountClick -> handleLogoutAccountClicked(action)
            is LandingAction.SwitchAccountClick -> handleSwitchAccountClicked(action)
            is LandingAction.ConfirmSwitchToMatchingAccountClick -> {
                handleConfirmSwitchToMatchingAccountClicked(action)
            }

            is LandingAction.ContinueButtonClick -> handleContinueButtonClicked()
            LandingAction.ContinueWithoutAccountClick -> sendEvent(LandingEvent.NavigateToLocalVault)
            LandingAction.CreateAccountClick -> handleCreateAccountClicked()
            is LandingAction.SocialSignInClick -> handleSocialSignInClicked(action.provider)
            is LandingAction.DialogDismiss -> handleDialogDismiss()
            is LandingAction.RememberMeToggle -> handleRememberMeToggled(action)
            is LandingAction.EmailInputChanged -> handleEmailInputChanged(action)
            is LandingAction.EnvironmentTypeSelect -> handleEnvironmentTypeSelect(action)
            is LandingAction.Internal -> handleInternalActions(action)
        }
    }

    private fun handleInternalActions(action: LandingAction.Internal) {
        when (action) {
            is LandingAction.Internal.UpdateEmailState -> handleInternalEmailStateUpdate(action)
            is LandingAction.Internal.UpdatedEnvironmentReceive -> {
                handleUpdatedEnvironmentReceive(action)
            }

            is LandingAction.Internal.SnackbarDataReceived -> handleSnackbarDataReceived(action)
            is LandingAction.Internal.FedRampFeatureUpdated -> handleFedRampFeatureUpdated(action)
            is LandingAction.Internal.SocialLoginFeatureUpdated -> {
                mutableStateFlow.update { it.copy(isSocialLoginEnabled = action.isEnabled) }
            }
            is LandingAction.Internal.ServerConfigReceived -> handleServerConfigReceived(action)
            is LandingAction.Internal.ReceiveSsoPrevalidation -> viewModelScope.launch {
                handleSsoPrevalidation(action.provider, action.result)
            }
            is LandingAction.Internal.ReceiveSsoCallback -> handleSsoCallback(action.result)
            is LandingAction.Internal.ReceiveSocialLoginResult -> {
                handleReceiveSocialLoginResult(action.provider, action.loginResult)
            }
        }
    }

    private fun handleAppSettingsClick() {
        sendEvent(LandingEvent.NavigateToSettings)
    }

    private fun handleLockAccountClicked(action: LandingAction.LockAccountClick) {
        vaultRepository.lockVault(userId = action.accountSummary.userId, isUserInitiated = true)
    }

    private fun handleLogoutAccountClicked(action: LandingAction.LogoutAccountClick) {
        authRepository.logout(
            userId = action.accountSummary.userId,
            reason = LogoutReason.Click(source = "LandingViewModel"),
        )
    }

    private fun handleSwitchAccountClicked(action: LandingAction.SwitchAccountClick) {
        authRepository.switchAccount(userId = action.accountSummary.userId)
    }

    private fun handleConfirmSwitchToMatchingAccountClicked(
        action: LandingAction.ConfirmSwitchToMatchingAccountClick,
    ) {
        authRepository.switchAccount(userId = action.accountSummary.userId)
    }

    private fun handleEmailInputChanged(action: LandingAction.EmailInputChanged) {
        updateEmailInput(action.input)
    }

    private fun handleInternalEmailStateUpdate(action: LandingAction.Internal.UpdateEmailState) {
        updateEmailInput(action.emailInput)
    }

    private fun updateEmailInput(updatedInput: String) {
        mutableStateFlow.update {
            it.copy(
                emailInput = updatedInput,
                isContinueButtonEnabled = updatedInput.isNotBlank(),
            )
        }
    }

    private fun handleContinueButtonClicked() {
        if (!state.emailInput.isValidEmail(useStrictValidation = false)) {
            mutableStateFlow.update {
                it.copy(
                    dialog = LandingState.DialogState.Error(
                        message = VowkeyString.invalid_email.asText(),
                    ),
                )
            }
            return
        }

        matchingAccountSummary?.let { accountSummary ->
            mutableStateFlow.update {
                it.copy(
                    dialog = LandingState.DialogState.AccountAlreadyAdded(
                        accountSummary = accountSummary,
                    ),
                )
            }
            return
        }

        val email = state.emailInput
        val isRememberMeEnabled = state.isRememberEmailEnabled

        // Update the remembered email address
        authRepository.rememberedEmailAddress = email.takeUnless { !isRememberMeEnabled }

        sendEvent(LandingEvent.NavigateToLogin(email))
    }

    private fun handleCreateAccountClicked() {
        sendEvent(LandingEvent.NavigateToStartRegistration)
    }

    private fun handleDialogDismiss() {
        mutableStateFlow.update {
            it.copy(dialog = null)
        }
    }

    private fun handleRememberMeToggled(action: LandingAction.RememberMeToggle) {
        mutableStateFlow.update { it.copy(isRememberEmailEnabled = action.isChecked) }
    }

    private fun handleEnvironmentTypeSelect(action: LandingAction.EnvironmentTypeSelect) {
        val environment = when (action.environmentType) {
            Environment.Type.US -> Environment.Prod.Us
            Environment.Type.EU -> Environment.Prod.Eu
            Environment.Type.FED_RAMP -> Environment.Prod.FedRamp
            Environment.Type.SELF_HOSTED -> {
                // Launch the self-hosted screen and select the full environment details there.
                sendEvent(LandingEvent.NavigateToEnvironment)
                return
            }
        }

        // Update the environment in the repo; the VM state will update accordingly because it is
        // listening for changes.
        environmentRepository.environment = environment
    }

    private fun handleUpdatedEnvironmentReceive(
        action: LandingAction.Internal.UpdatedEnvironmentReceive,
    ) {
        mutableStateFlow.update {
            it.copy(
                selectedEnvironmentType = action.environment.type,
                selectedEnvironmentLabel = action.environment.label,
                isSelectedEnvironmentFedRamp = action.environment.isFedRamp,
            )
        }
    }

    private fun handleSnackbarDataReceived(action: LandingAction.Internal.SnackbarDataReceived) {
        sendEvent(LandingEvent.ShowSnackbar(action.data))
    }

    private fun handleFedRampFeatureUpdated(action: LandingAction.Internal.FedRampFeatureUpdated) {
        mutableStateFlow.update { it.copy(isFedRampEnabled = action.isEnabled) }
    }

    private fun handleServerConfigReceived(action: LandingAction.Internal.ServerConfigReceived) {
        mutableStateFlow.update {
            it.copy(
                disableCreateAccount = action
                    .serverConfig
                    ?.serverData
                    ?.settings
                    ?.disableUserRegistration == true,
            )
        }
    }

    /**
     * If the user state account is changed to an active but not "logged in" account we can
     * pre-populate the email field with this account.
     */
    private fun mapToInternalActionOrNull(
        activeAccount: UserState.Account,
    ): LandingAction.Internal.UpdateEmailState? {
        val activeUserNotLoggedIn = !activeAccount.isLoggedIn
        val noPendingAdditions = !authRepository.hasPendingAccountAddition
        return LandingAction.Internal.UpdateEmailState(activeAccount.email)
            .takeIf { activeUserNotLoggedIn && noPendingAdditions }
    }

    private fun handleSocialSignInClicked(provider: String) {
        if (!networkConnectionManager.isNetworkConnected) {
            mutableStateFlow.update {
                it.copy(
                    dialog = LandingState.DialogState.Error(
                        message = VowkeyString.internet_connection_required_message.asText(),
                    ),
                )
            }
            return
        }
        mutableStateFlow.update {
            it.copy(dialog = LandingState.DialogState.Loading(VowkeyString.logging_in.asText()))
        }
        viewModelScope.launch {
            sendAction(
                LandingAction.Internal.ReceiveSsoPrevalidation(
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
                    dialog = LandingState.DialogState.Error(
                        message = failure.message?.asText() ?: VowkeyString.login_sso_error.asText(),
                    ),
                )
            }
            return
        }
        val codeVerifier = generatorRepository.generateRandomString(SSO_RANDOM_LENGTH)
        val ssoState = "${generatorRepository.generateRandomString(SSO_RANDOM_LENGTH)}_identifier=$provider"
        val environment = environmentRepository.environment
        val authTabData = environment.ssoAuthTabData
        savedStateHandle[KEY_LANDING_SOCIAL_SSO] = LandingSocialSsoData(
            provider = provider,
            redirectUri = authTabData.callbackUrl,
            state = ssoState,
            codeVerifier = codeVerifier,
        )
        sendEvent(
            LandingEvent.NavigateToSocialSignIn(
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
        val saved = savedStateHandle.get<LandingSocialSsoData>(KEY_LANDING_SOCIAL_SSO) ?: return
        savedStateHandle[KEY_LANDING_SOCIAL_SSO] = null
        if (result is SsoCallbackResult.MissingCode) {
            mutableStateFlow.update { it.copy(dialog = null) }
            return
        }
        if (result !is SsoCallbackResult.Success || result.state != saved.state) {
            mutableStateFlow.update {
                it.copy(
                    dialog = LandingState.DialogState.Error(
                        message = VowkeyString.login_sso_error.asText(),
                    ),
                )
            }
            return
        }
        mutableStateFlow.update {
            it.copy(dialog = LandingState.DialogState.Loading(VowkeyString.logging_in.asText()))
        }
        viewModelScope.launch {
            val loginResult = authRepository.login(
                email = state.emailInput.trim(),
                ssoCode = result.code,
                ssoCodeVerifier = saved.codeVerifier,
                ssoRedirectUri = saved.redirectUri,
                organizationIdentifier = saved.provider,
            )
            sendAction(
                LandingAction.Internal.ReceiveSocialLoginResult(
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
            is LoginResult.TwoFactorRequired -> {
                mutableStateFlow.update { it.copy(dialog = null) }
                sendEvent(
                    LandingEvent.NavigateToTwoFactorLogin(
                        emailAddress = state.emailInput.trim(),
                        orgIdentifier = provider,
                    ),
                )
            }
            is LoginResult.NewDeviceVerification -> {
                mutableStateFlow.update { it.copy(dialog = null) }
                sendEvent(
                    LandingEvent.NavigateToTwoFactorLogin(
                        emailAddress = state.emailInput.trim(),
                        orgIdentifier = provider,
                    ),
                )
            }
            is LoginResult.EncryptionKeyMigrationRequired -> {
                val vaultUrl = environmentRepository.environment.baseWebVaultUrlOrDefault
                mutableStateFlow.update {
                    it.copy(
                        dialog = LandingState.DialogState.Error(
                            message = VowkeyString
                                .this_account_will_soon_be_deleted_log_in_at_x_to_continue_using_vowkey
                                .asText(vaultUrl.toUriOrNull()?.host ?: vaultUrl),
                        ),
                    )
                }
            }
            is LoginResult.Error -> {
                mutableStateFlow.update {
                    it.copy(
                        dialog = LandingState.DialogState.Error(
                            message = loginResult.errorMessage?.asText()
                                ?: VowkeyString.login_sso_error.asText(),
                        ),
                    )
                }
            }
            LoginResult.UnofficialServerError -> {
                mutableStateFlow.update {
                    it.copy(
                        dialog = LandingState.DialogState.Error(
                            message = VowkeyString.login_sso_error.asText(),
                        ),
                    )
                }
            }
            LoginResult.CertificateError -> {
                mutableStateFlow.update {
                    it.copy(
                        dialog = LandingState.DialogState.Error(
                            message = VowkeyString.we_couldnt_verify_the_servers_certificate.asText(),
                        ),
                    )
                }
            }
            is LoginResult.ConfirmKeyConnectorDomain -> {
                mutableStateFlow.update { it.copy(dialog = null) }
            }
        }
    }
}

/**
 * Models state of the landing screen.
 */
@Parcelize
data class LandingState(
    val emailInput: String,
    val isContinueButtonEnabled: Boolean,
    val isRememberEmailEnabled: Boolean,
    val selectedEnvironmentType: Environment.Type,
    val selectedEnvironmentLabel: String,
    val isSelectedEnvironmentFedRamp: Boolean,
    val dialog: DialogState?,
    val accountSummaries: ImmutableList<AccountSummary>,
    val isFedRampEnabled: Boolean,
    val disableCreateAccount: Boolean,
    val isSocialLoginEnabled: Boolean = false,
) : Parcelable {
    /**
     * The selectable environments.
     */
    val environmentTypeOptions: ImmutableList<Environment.Type>
        get() = Environment.Type
            .entries
            .filterNot { it == Environment.Type.FED_RAMP && !isFedRampEnabled }
            .toImmutableList()

    /**
     * Determines if the user should be allowed to create a new account.
     */
    val allowCreateAccount: Boolean get() = !disableCreateAccount && !isSelectedEnvironmentFedRamp

    /**
     * Determines whether the app bar should be visible based on the presence of account summaries.
     */
    val isAppBarVisible: Boolean
        get() = accountSummaries.isNotEmpty()

    /**
     * Represents the current state of any dialogs on screen.
     */
    sealed class DialogState : Parcelable {

        /**
         * Represents a dialog indicating that the current email matches the existing
         * [accountSummary].
         */
        @Parcelize
        data class AccountAlreadyAdded(
            val accountSummary: AccountSummary,
        ) : DialogState()

        /**
         * Represents an error dialog with the given [message].
         */
        @Parcelize
        data class Error(
            val message: Text,
        ) : DialogState()

        @Parcelize
        data class Loading(
            val message: Text,
        ) : DialogState()
    }
}

/**
 * Models events for the landing screen.
 */
sealed class LandingEvent {
    /**
     * Navigates to the Start Registration screen.
     */
    data object NavigateToStartRegistration : LandingEvent()

    /**
     * Navigates to the pre-auth settings screen.
     */
    data object NavigateToSettings : LandingEvent()

    /**
     * Navigates to the Login screen with the given email address and region label.
     */
    data class NavigateToLogin(
        val emailAddress: String,
    ) : LandingEvent()

    data object NavigateToLocalVault : LandingEvent()

    /**
     * Navigates to the self-hosted/custom environment screen.
     */
    data object NavigateToEnvironment : LandingEvent()

    data class NavigateToSocialSignIn(
        val uri: Uri,
        val authTabData: AuthTabData,
    ) : LandingEvent()

    data class NavigateToTwoFactorLogin(
        val emailAddress: String,
        val orgIdentifier: String?,
    ) : LandingEvent()

    /**
     * Show a snackbar with the given [data].
     */
    data class ShowSnackbar(
        val data: VowkeySnackbarData,
    ) : LandingEvent(), BackgroundEvent
}

/**
 * Models actions for the landing screen.
 */
sealed class LandingAction {
    /**
     * Indicates that the app settings button has been clicked.
     */
    data object AppSettingsClick : LandingAction()

    /**
     * Indicates the user has clicked on the given [accountSummary] information in order to lock
     * the associated account's vault.
     */
    data class LockAccountClick(
        val accountSummary: AccountSummary,
    ) : LandingAction()

    /**
     * Indicates the user has clicked on the given [accountSummary] information in order to log out
     * of that account.
     */
    data class LogoutAccountClick(
        val accountSummary: AccountSummary,
    ) : LandingAction()

    /**
     * Indicates the user has clicked on the given [accountSummary] information in order to switch
     * to it.
     */
    data class SwitchAccountClick(
        val accountSummary: AccountSummary,
    ) : LandingAction()

    /**
     * Indicates the user has confirmed they would like to switch to the existing [accountSummary].
     */
    data class ConfirmSwitchToMatchingAccountClick(
        val accountSummary: AccountSummary,
    ) : LandingAction()

    /**
     * Indicates that the continue button has been clicked and the app should navigate to Login.
     */
    data object ContinueButtonClick : LandingAction()
    data object ContinueWithoutAccountClick : LandingAction()


    /**
     * Indicates that the Create Account text was clicked.
     */
    data object CreateAccountClick : LandingAction()

    data class SocialSignInClick(
        val provider: String,
    ) : LandingAction()

    /**
     * Indicates that a dialog is attempting to be dismissed.
     */
    data object DialogDismiss : LandingAction()

    /**
     * Indicates that the Remember Me switch has been toggled.
     */
    data class RememberMeToggle(
        val isChecked: Boolean,
    ) : LandingAction()

    /**
     * Indicates that the input on the email field has changed.
     */
    data class EmailInputChanged(
        val input: String,
    ) : LandingAction()

    /**
     * Indicates that the selection from the region drop down has changed.
     */
    data class EnvironmentTypeSelect(
        val environmentType: Environment.Type,
    ) : LandingAction()

    /**
     * Actions for internal use by the ViewModel.
     */
    sealed class Internal : LandingAction() {
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
         * Internal action to update the email input state from a non-user action
         */
        data class UpdateEmailState(val emailInput: String) : Internal()

        /**
         * Indicates that an updated [serverConfig] has been received.
         */
        data class ServerConfigReceived(
            val serverConfig: ServerConfig?,
        ) : Internal()

        /**
         * Indicates that FedRamp feature has been enabled or disabled.
         */
        data class FedRampFeatureUpdated(
            val isEnabled: Boolean,
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
private data class LandingSocialSsoData(
    val provider: String,
    val redirectUri: String,
    val state: String,
    val codeVerifier: String,
) : Parcelable
