// MARK: - LoginState

/// An object that defines the current state of a `LoginView`.
///
struct LoginState: Equatable {
    // MARK: Properties

    /// The master password provided by the user.
    var masterPassword: String = ""

    /// A flag indicating if the master password should be revealed or not.
    var isMasterPasswordRevealed: Bool = false

    /// A flag indicating if the login with device button should be displayed or not.
    var isLoginWithDeviceVisible: Bool = false

    /// Whether the user is logging into a newly created account.
    var isNewAccount = false

    /// The server URL that is hosting the user's session.
    var serverURLString: String = ""

    /// The username provided by the user on the landing screen.
    var username: String = ""

    /// The raw nonce for the current Sign in with Apple request. Apple receives its SHA-256 hash.
    var appleNonce: String = ""

    /// Whether social OAuth sign-in (Google / GitHub) is enabled on the active server.
    var isSocialLoginEnabled: Bool = false

    /// Social OAuth provider currently opening a web authentication session, if any.
    var socialLoadingProvider: String?
}
