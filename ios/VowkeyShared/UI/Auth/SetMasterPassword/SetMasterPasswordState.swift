import VowkeyResources
@preconcurrency import VowkeySdk

// MARK: - SetMasterPasswordState

/// An object that defines the current state of a `SetMasterPasswordView`.
///
struct SetMasterPasswordState: Equatable, Sendable {
    // MARK: Properties

    /// A flag indicating if the current master password should be revealed or not.
    var isCurrentMasterPasswordRevealed: Bool = false

    /// A flag indicating if the new master password should be revealed or not.
    var isMasterPasswordRevealed: Bool = false

    /// Indicates if the reason to set password was privilege elevation.
    var isPrivilegeElevation: Bool = false

    /// The new master password provided by the user.
    var masterPassword: String = ""

    /// The new master password hint provided by the user.
    var masterPasswordHint: String = ""

    /// The master password policy in effect.
    var masterPasswordPolicy: MasterPasswordPolicyOptions?

    /// The retype of new master password provided by the user.
    var masterPasswordRetype: String = ""

    /// The organization's ID (UUID).
    var organizationId: String?

    /// The organization's identifier.
    var organizationIdentifier: String

    /// Whether the user will be automatically enrolled in reset password.
    var resetPasswordAutoEnroll = false

    // MARK: Computed Properties

    /// Whether this password setup is for personal social sign-in rather than an enterprise organization.
    var isPersonalSocialSso: Bool {
        [
            "google",
            "github",
            "apple",
            "00000000-01dc-01dc-01dc-000000000000",
        ].contains(organizationIdentifier.lowercased())
    }

    /// The explanation text based on requestType
    var explanationText: String {
        if isPersonalSocialSso {
            Localizations.vowkeySetPersonalPasswordExplanation
        } else if isPrivilegeElevation {
            Localizations.yourOrganizationPermissionsWereUpdatedRequeringYouToSetAMasterPassword
        } else {
            Localizations.yourOrganizationRequiresYouToSetAMasterPassword
        }
    }
}
