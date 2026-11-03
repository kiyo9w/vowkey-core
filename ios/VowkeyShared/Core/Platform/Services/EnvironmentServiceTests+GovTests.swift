import VowkeyKit
import Foundation
import Testing

@testable import VowkeyShared
@testable import VowkeySharedMocks

extension EnvironmentServiceTests {
    // MARK: Tests

    /// `loadURLsForActiveAccount()` handles government cloud (FedRAMP) URLs.
    @Test
    func loadURLsForActiveAccount_gov() async {
        let urls = EnvironmentURLData.defaultGov
        let account = Account.fixture(settings: .fixture(environmentURLs: urls))
        stateService.activeAccount = account
        stateService.environmentURLs = [account.profile.userId: urls]

        await subject.loadURLsForActiveAccount()

        #expect(subject.apiURL == URL(string: "https://api.vowkey-gov.com"))
        #expect(subject.baseURL == URL(string: "https://vault.vowkey-gov.com"))
        #expect(subject.changeEmailURL == URL(string: "https://vault.vowkey-gov.com/#/settings/account"))
        #expect(subject.eventsURL == URL(string: "https://events.vowkey-gov.com"))
        #expect(subject.iconsURL == URL(string: "https://icons.vowkey-gov.com"))
        #expect(subject.identityURL == URL(string: "https://identity.vowkey-gov.com"))
        #expect(subject.importItemsURL == URL(string: "https://vault.vowkey-gov.com/#/tools/import"))
        #expect(
            subject.proxyCookieRedirectConnectorURL
                == URL(string: "https://vault.vowkey-gov.com/proxy-cookie-redirect-connector.html"),
        )
        #expect(subject.recoveryCodeURL == URL(string: "https://vault.vowkey-gov.com/#/recover-2fa"))
        #expect(subject.region == .gov)
        #expect(subject.sendShareURL == URL(string: "https://send.vowkey-gov.com/#"))
        #expect(subject.settingsURL == URL(string: "https://vault.vowkey-gov.com/#/settings"))
        #expect(
            subject.setUpTwoFactorURL
                == URL(string: "https://vault.vowkey-gov.com/#/settings/security/two-factor"),
        )
        #expect(subject.webVaultURL == URL(string: "https://vault.vowkey-gov.com"))
        #expect(stateService.preAuthEnvironmentURLs == urls)

        #expect(errorReporter.region?.region == "Gov")
        #expect(errorReporter.region?.isPreAuth == false)
    }
}
