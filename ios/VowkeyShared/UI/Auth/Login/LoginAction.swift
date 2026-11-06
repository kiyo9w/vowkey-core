// MARK: - LoginAction

/// Actions that can be processed by a `LoginProcessor`.
enum LoginAction: Equatable {
    /// The get master password hint button was pressed.
    case getMasterPasswordHintPressed

    /// The enterprise single sign-on button was pressed.
    case enterpriseSingleSignOnPressed

    /// Sign in with Apple is preparing its request with this raw nonce.
    case signInWithAppleRequested(nonce: String)

    /// Sign in with Apple returned an identity token.
    case signInWithAppleCompleted(identityToken: String, email: String?)

    /// Sign in with Apple failed. Cancellation does not send this action.
    case signInWithAppleFailed(String)

    /// The login with device button was pressed.
    case loginWithDevicePressed

    /// The value for the master password was changed.
    case masterPasswordChanged(String)

    /// The not you? button was pressed.
    case notYouPressed

    /// The reveal master password field button was pressed.
    case revealMasterPasswordFieldPressed(Bool)
}
