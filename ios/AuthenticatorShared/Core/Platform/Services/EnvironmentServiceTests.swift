import VowkeyKit
import VowkeyKitMocks
import Foundation
import Testing

@testable import AuthenticatorShared

struct EnvironmentServiceTests {
    // MARK: Properties

    let subject: EnvironmentService

    // MARK: Setup & Teardown

    init() {
        subject = DefaultEnvironmentService()
    }

    // MARK: Tests

    /// `apiURL` and other URL properties return US default values.
    @Test
    func defaultUrls() {
        #expect(subject.apiURL == URL(string: "https://api.vowkey.com"))
        #expect(subject.baseURL == URL(string: "https://vault.vowkey.com"))
        #expect(subject.changeEmailURL == URL(string: "https://vault.vowkey.com/#/settings/account"))
        #expect(subject.eventsURL == URL(string: "https://events.vowkey.com"))
        #expect(subject.iconsURL == URL(string: "https://icons.vowkey.net"))
        #expect(subject.identityURL == URL(string: "https://identity.vowkey.com"))
        #expect(subject.importItemsURL == URL(string: "https://vault.vowkey.com/#/tools/import"))
        #expect(
            subject.proxyCookieRedirectConnectorURL
                == URL(string: "https://vault.vowkey.com/proxy-cookie-redirect-connector.html"),
        )
        #expect(subject.recoveryCodeURL == URL(string: "https://vault.vowkey.com/#/recover-2fa"))
        #expect(subject.region == .unitedStates)
        #expect(subject.sendShareURL == URL(string: "https://send.vowkey.com/#"))
        #expect(subject.settingsURL == URL(string: "https://vault.vowkey.com/#/settings"))
        #expect(
            subject.setUpTwoFactorURL
                == URL(string: "https://vault.vowkey.com/#/settings/security/two-factor"),
        )
        #expect(
            subject.fillAssistRulesURL
                == URL(string: "https://fillassist.vowkey.com"),
        )
        #expect(subject.webVaultURL == URL(string: "https://vault.vowkey.com"))
    }
}
