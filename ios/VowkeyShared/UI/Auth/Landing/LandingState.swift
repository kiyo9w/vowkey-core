import VowkeyKit

// MARK: - LandingState

/// An object that defines the current state of a `LandingView`.
///
struct LandingState: Equatable {
    // MARK: Properties

    /// The email address provided by the user.
    var email: String

    /// A flag indicating if the continue button is enabled.
    var isContinueButtonEnabled: Bool {
        !email.isEmpty
    }

    /// A flag indicating if the create account button should be hidden.
    var isCreateAccountButtonHidden: Bool

    /// A flag indicating if the "Remember Me" toggle is on.
    var isRememberMeOn: Bool

    /// Whether social OAuth sign-in (Google / GitHub) is enabled on the active server.
    var isSocialLoginEnabled: Bool

    /// The user's current account profile state and alternative accounts.
    var profileSwitcherState: ProfileSwitcherState

    /// The region selected by the user.
    var region: RegionType

    /// Social OAuth provider currently opening a web authentication session, if any.
    var socialLoadingProvider: String?

    /// A toast message to show in the view.
    var toast: Toast?

    // MARK: Initialization

    /// Creates a new `LandingState`.
    ///
    /// - Parameters:
    ///   - email: The email address provided by the user.
    ///   - isCreateAccountButtonHidden: A flag indicating if the create account button should be hidden.
    ///   - isRememberMeOn: A flag indicating if the "Remember Me" toggle is on.
    ///   - isSocialLoginEnabled: Whether social OAuth sign-in is enabled.
    ///   - profileSwitcherState: State for the profile switcher.
    ///   - region: The region selected by the user.
    ///
    init(
        email: String = "",
        isCreateAccountButtonHidden: Bool = false,
        isRememberMeOn: Bool = false,
        isSocialLoginEnabled: Bool = false,
        profileSwitcherState: ProfileSwitcherState = .empty(
            shouldAlwaysHideAddAccount: true,
            showPlaceholderToolbarIcon: true,
        ),
        region: RegionType = .unitedStates,
    ) {
        self.email = email
        self.isCreateAccountButtonHidden = isCreateAccountButtonHidden
        self.isRememberMeOn = isRememberMeOn
        self.isSocialLoginEnabled = isSocialLoginEnabled
        self.profileSwitcherState = profileSwitcherState
        self.region = region
    }
}
