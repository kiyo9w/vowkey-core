import VowkeyKit
import Foundation

// MARK: - ExternalLinksConstants

/// Links that are used throughout the app.
///
extension ExternalLinksConstants {
    // MARK: Properties

    /// A link to Vowkey's organizations information webpage.
    static let aboutOrganizations = URL(string: "https://vowkey.app/help/about-organizations")!

    /// A deep link to the Vowkey app.
    static let appDeepLink = URL(string: "vowkey://")!

    /// A link to the Vowkey iOS download and review page.
    static let appReview = URL(string: "https://vowkey.app/download/ios")

    /// A link to Vowkey's help page for the integrated authenticator feature.
    static let authenticatorHelp = URL(string: "https://vowkey.app/help/integrated-authenticator")!

    /// A link to the auto fill help page.
    static let autofillHelp = URL(string: "https://vowkey.app/help/auto-fill-ios/#keyboard-auto-fill")!

    /// A link to Vowkey's help page for the Fill Assist feature.
    static let fillAssistHelp = URL(string: "https://vowkey.app/help/fill-assist/")!

    /// A link to Vowkey's help page for learning more about the account fingerprint phrase.
    static let fingerprintPhrase = URL(string: "https://vowkey.app/help/fingerprint-phrase/")!

    /// A link to Vowkey's help page for generating username types.
    static let generatorUsernameTypes = URL(string: "https://vowkey.app/help/generator/#username-types")!

    /// A link to the import logins help page.
    static let importHelp = URL(string: "https://vowkey.app/help/import-data/")!

    /// A link to Vowkey's help page for learning more about Premium features.
    static let learnMoreAboutPremium = URL(string: "https://vowkey.app/help/password-manager-plans/")!

    /// A link to the password options within the passwords section of the settings menu.
    static let passwordOptions = URL(string: "App-prefs:PASSWORDS&path=PASSWORD_OPTIONS")!

    /// A markdown link to Vowkey's help page about protecting individual items.
    static let protectIndividualItems = URL(
        string: "https://vowkey.app/help/managing-items/#protect-individual-items",
    )!

    /// A link to Vowkey's product page for Sends.
    static let sendInfo = URL(string: "https://vowkey.app/products/send/")!

    /// A markdown link to Vowkey's terms of service.
    static let termsOfService = URL(string: "https://vowkey.app/terms/")!

    /// A link to Vowkey's help page for My vault items migration. .
    static let transferOwnership = URL(string: "https://vowkey.app/help/transfer-ownership/")!

    /// A markdown link to Vowkey's marketing email preferences.
    static let unsubscribeFromMarketingEmails = URL(string: "https://vowkey.app/email-preferences/")!

    /// A link to Vowkey's help page for URI match detection.
    static let uriMatchDetections = URL(string: "https://vowkey.app/help/uri-match-detection/")!

    /// A link to Vowkey's help page for showing website icons.
    static let websiteIconsHelp = URL(string: "https://vowkey.app/help/website-icons/")!
}
