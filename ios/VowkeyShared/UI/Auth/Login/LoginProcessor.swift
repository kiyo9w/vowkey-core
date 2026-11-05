import CryptoKit
import AuthenticationServices
import VowkeyKit
import VowkeyResources
import VowkeySdk
import Foundation

// MARK: - LoginProcessor

/// The processor used to manage state and handle actions for the login screen.
///
class LoginProcessor: StateProcessor<LoginState, LoginAction, LoginEffect> {
    // MARK: Types

    typealias Services = HasAppIDService
        & HasAuthRepository
        & HasAuthService
        & HasConfigService
        & HasDeviceAPIService
        & HasErrorReporter
        & HasPolicyService

    // MARK: Private Properties

    /// The `Coordinator` that handles navigation.
    private var coordinator: AnyCoordinator<AuthRoute, AuthEvent>

    /// A flag indicating if this is the first time that the view has appeared.
    ///
    /// This flag keeps us from making the known device call multiple times as the user navigates away from,
    /// and back to the same instance of `LoginView`.
    private var isFirstAppeared = true

    /// The services used by this processor.
    private var services: Services

    /// Active social OAuth provider identifier ("google" or "github") during an SSO session.
    private var activeSocialProvider: String?

    // MARK: Initialization

    /// Creates a new `LoginProcessor`.
    ///
    /// - Parameters:
    ///   - coordinator: The coordinator that handles navigation.
    ///   - state: The initial state of the processor.
    ///
    init(
        coordinator: AnyCoordinator<AuthRoute, AuthEvent>,
        services: Services,
        state: LoginState,
    ) {
        self.coordinator = coordinator
        self.services = services
        super.init(state: state)
    }

    // MARK: Methods

    override func perform(_ effect: LoginEffect) async {
        switch effect {
        case .appeared:
            state.isSocialLoginEnabled = await services.configService.getFeatureFlag(
                .socialLogin,
                isPreAuth: true,
            )
            await refreshKnownDevice()
        case .loginWithMasterPasswordPressed:
            await loginWithMasterPassword()
        case let .socialSignInPressed(provider):
            await startSocialSignIn(provider: provider)
        }
    }

    override func receive(_ action: LoginAction) {
        switch action {
        case .enterpriseSingleSignOnPressed:
            coordinator.navigate(to: .enterpriseSingleSignOn(email: state.username))
        case let .signInWithAppleRequested(nonce):
            state.appleNonce = nonce
        case let .signInWithAppleCompleted(identityToken, email):
            Task { await completeSignInWithApple(identityToken: identityToken, email: email) }
        case let .signInWithAppleFailed(message):
            Task { await handleErrorResponse(AppleSignInError(message: message)) }
        case .getMasterPasswordHintPressed:
            coordinator.navigate(to: .masterPasswordHint(username: state.username))
        case .loginWithDevicePressed:
            coordinator.navigate(to: .loginWithDevice(
                email: state.username,
                authRequestType: AuthRequestType.authenticateAndUnlock,
                isAuthenticated: false,
            ))
        case let .masterPasswordChanged(newValue):
            state.masterPassword = newValue
        case .notYouPressed:
            coordinator.navigate(to: .landing)
        case .revealMasterPasswordFieldPressed:
            state.isMasterPasswordRevealed.toggle()
        }
    }

    // MARK: Private Methods

    /// Attempts to log the user in with the email address and password values found in `state`.
    ///
    ///
    private func loginWithMasterPassword() async {
        // Hide the loading overlay when exiting this method, in case it hasn't been hidden yet.
        defer { coordinator.hideLoadingOverlay() }

        do {
            try EmptyInputValidator(fieldName: Localizations.masterPassword)
                .validate(input: state.masterPassword)
            coordinator.showLoadingOverlay(title: Localizations.loggingIn)

            // Login.
            try await services.authService.loginWithMasterPassword(
                state.masterPassword,
                username: state.username,
                isNewAccount: state.isNewAccount,
            )

            // Unlock the vault.
            try await services.authRepository.unlockVaultWithPassword(password: state.masterPassword)
            coordinator.hideLoadingOverlay()
            await coordinator.handleEvent(.didCompleteAuth)
        } catch let error as InputValidationError {
            coordinator.showAlert(.inputValidationAlert(error: error))
        } catch let error as IdentityTokenRequestError {
            switch error {
            case let .twoFactorRequired(authMethodsData, _, _):
                coordinator.navigate(
                    to: .twoFactor(state.username, .password(state.masterPassword), authMethodsData, nil),
                )
            case .twoFactorProvidersNotConfigured:
                await handleErrorResponse(error)
            case .newDeviceNotVerified:
                coordinator.navigate(
                    to: .twoFactor(
                        state.username,
                        .password(state.masterPassword),
                        AuthMethodsData(email: Email(email: state.username)),
                        nil,
                        true,
                    ),
                )
            case .encryptionKeyMigrationRequired:
                coordinator.showAlert(.encryptionKeyMigrationRequiredAlert(environmentUrl: state.serverURLString))
            }
        } catch {
            await handleErrorResponse(error)
        }
    }

    /// Refreshes the value for known device from the API, and then updates the state to show or hide the
    /// "Login with known device" button based on that value.
    ///
    private func refreshKnownDevice() async {
        guard isFirstAppeared else { return }
        coordinator.showLoadingOverlay(title: Localizations.loading)
        defer {
            isFirstAppeared = false
            coordinator.hideLoadingOverlay()
        }

        do {
            let deviceIdentifier = await services.appIDService.getOrCreateAppID()
            let isKnownDevice = try await services.deviceAPIService.knownDevice(
                email: state.username,
                deviceIdentifier: deviceIdentifier,
            )
            state.isLoginWithDeviceVisible = isKnownDevice
        } catch {
            services.errorReporter.log(error: error)
        }
    }

    /// Handles network error responses.
    ///
    /// Determines whether the Vowkey server is official or unofficial and passes this information
    /// along with the error to the coordinator to display an appropriate alert on the main thread.
    /// The error is also logged using the error reporter.
    ///
    /// - Parameter error: The error received from the network request.
    ///
    private func handleErrorResponse(_ error: Error) async {
        services.errorReporter.log(error: error)
        let serverConfig = await services.configService.getConfig(isPreAuth: true)
        let isOfficialVowkeyServer = serverConfig?.isOfficialVowkeyServer() ?? true
        coordinator.showAlert(
            .networkResponseError(
                error,
                isOfficialVowkeyServer: isOfficialVowkeyServer,
            ),
        )
    }


    private func completeSignInWithApple(identityToken: String, email: String?) async {
        let email = email ?? state.username
        let nonce = state.appleNonce
        state.appleNonce = ""
        defer { coordinator.hideLoadingOverlay() }
        coordinator.showLoadingOverlay(title: Localizations.loggingIn)
        do {
            switch try await services.authService.loginWithApple(identityToken: identityToken, nonce: nonce, email: email) {
            case .deviceKey:
                try await services.authRepository.unlockVaultWithDeviceKey()
                await coordinator.handleEvent(.didCompleteAuth)
            case let .masterPassword(account):
                coordinator.navigate(to: .vaultUnlock(
                    account,
                    animated: false,
                    attemptAutomaticBiometricUnlock: true,
                    didSwitchAccountAutomatically: false,
                ))
            case let .keyConnector(wrappedUserKey, keyConnectorUrl):
                guard let wrappedUserKey else { throw AuthError.requireDecryptionOptions }
                try await services.authRepository.unlockVaultWithKeyConnectorKey(
                    keyConnectorKeyWrappedUserKey: wrappedUserKey,
                    keyConnectorURL: keyConnectorUrl,
                )
                await coordinator.handleEvent(.didCompleteAuth)
            }
        } catch let error as IdentityTokenRequestError {
            switch error {
            case let .twoFactorRequired(authMethodsData, _, _):
                coordinator.navigate(to: .twoFactor(email, nil, authMethodsData, nil))
            case .newDeviceNotVerified:
                coordinator.navigate(to: .twoFactor(
                    email,
                    nil,
                    AuthMethodsData(email: Email(email: email)),
                    nil,
                    true,
                ))
            case .encryptionKeyMigrationRequired:
                coordinator.showAlert(.encryptionKeyMigrationRequiredAlert(environmentUrl: state.serverURLString))
            case .twoFactorProvidersNotConfigured:
                await handleErrorResponse(error)
            }
        } catch AuthError.requireSetPassword {
            coordinator.navigate(to: .setMasterPassword(organizationIdentifier: "apple"))
        } catch AuthError.requireDecryptionOptions {
            coordinator.navigate(to: .showLoginDecryptionOptions(organizationIdentifier: "apple"))
        } catch {
            await handleErrorResponse(error)
        }
    }
}

// MARK: - SingleSignOnFlowDelegate

extension LoginProcessor: SingleSignOnFlowDelegate {
    private func startSocialSignIn(provider: String) async {
        guard state.socialLoadingProvider == nil else { return }
        activeSocialProvider = provider
        state.socialLoadingProvider = provider
        do {
            let result = try await services.authService.generateSingleSignOnUrl(from: provider)
            coordinator.navigate(
                to: .singleSignOn(
                    state: result.state,
                    url: result.url,
                ),
                context: self,
            )
        } catch {
            state.socialLoadingProvider = nil
            await handleSocialSignInError(error, provider: provider)
        }
    }

    private func handleSocialSignInError(_ error: Error, provider: String) async {
        coordinator.hideLoadingOverlay()
        state.socialLoadingProvider = nil
        switch error {
        case ASWebAuthenticationSessionError.canceledLogin:
            break
        case let IdentityTokenRequestError.twoFactorRequired(authMethodsData, _, _):
            coordinator.navigate(to: .twoFactor(state.username, nil, authMethodsData, provider))
        case AuthError.requireSetPassword:
            coordinator.navigate(to: .setMasterPassword(organizationIdentifier: provider))
        case AuthError.requireDecryptionOptions:
            coordinator.navigate(to: .showLoginDecryptionOptions(organizationIdentifier: provider))
        default:
            await handleErrorResponse(error)
        }
    }

    func singleSignOnCompleted(code: String) {
        let provider = activeSocialProvider ?? "00000000-01DC-01DC-01DC-000000000000"
        let email = state.username
        Task { @MainActor in
            do {
                try await Task.sleep(forSeconds: UI.duration(0.35))
                coordinator.showLoadingOverlay(title: Localizations.loggingIn)
                let unlockMethod = try await services.authService.loginWithSingleSignOn(
                    code: code,
                    email: email,
                )
                state.socialLoadingProvider = nil
                switch unlockMethod {
                case .deviceKey:
                    try await services.authRepository.unlockVaultWithDeviceKey()
                    coordinator.hideLoadingOverlay()
                    await coordinator.handleEvent(.didCompleteAuth)
                case let .masterPassword(account):
                    coordinator.hideLoadingOverlay()
                    coordinator.navigate(
                        to: .vaultUnlock(
                            account,
                            animated: false,
                            attemptAutomaticBiometricUnlock: true,
                            didSwitchAccountAutomatically: false,
                        ),
                    )
                case let .keyConnector(keyConnectorKeyWrappedUserKey, keyConnectorUrl):
                    guard let keyConnectorKeyWrappedUserKey else {
                        throw AuthError.requireDecryptionOptions
                    }
                    try await services.authRepository.unlockVaultWithKeyConnectorKey(
                        keyConnectorKeyWrappedUserKey: keyConnectorKeyWrappedUserKey,
                        keyConnectorURL: keyConnectorUrl,
                    )
                    coordinator.hideLoadingOverlay()
                    await coordinator.handleEvent(.didCompleteAuth)
                }
            } catch {
                await handleSocialSignInError(error, provider: provider)
            }
        }
    }

    func singleSignOnErrored(error: Error) {
        let provider = activeSocialProvider ?? "00000000-01DC-01DC-01DC-000000000000"
        Task { @MainActor in
            try await Task.sleep(forSeconds: UI.duration(0.35))
            await handleSocialSignInError(error, provider: provider)
        }
    }
}

private struct AppleSignInError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

