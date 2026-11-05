// MARK: - LoginEffect

/// Effects that can be processed by a `LoginProcessor`.
enum LoginEffect: Equatable {
    /// The login view appeared on screen.
    case appeared

    /// The login with master password button was pressed.
    case loginWithMasterPasswordPressed

    /// A social OAuth sign-in button ("google" or "github") was pressed.
    case socialSignInPressed(String)
}
