import Foundation
import Testing

@testable import VowkeyKit

extension EnvironmentURLsTests {
    // MARK: Tests

    /// `init(environmentURLData:)` sets the URLs from the passed data when such data is the default
    /// government cloud (FedRAMP) region.
    @Test
    func init_environmentURLData_defaultGov() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData.defaultGov,
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://api.vowkey-gov.com")!,
                baseURL: URL(string: "https://vault.vowkey-gov.com")!,
                changeEmailURL: URL(string: "https://vault.vowkey-gov.com/#/settings/account")!,
                eventsURL: URL(string: "https://events.vowkey-gov.com")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://icons.vowkey-gov.com")!,
                identityURL: URL(string: "https://identity.vowkey-gov.com")!,
                importItemsURL: URL(string: "https://vault.vowkey-gov.com/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey-gov.com/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://vault.vowkey-gov.com/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://vault.vowkey-gov.com/#/recover-2fa")!,
                sendShareURL: URL(string: "https://send.vowkey-gov.com/#")!,
                settingsURL: URL(string: "https://vault.vowkey-gov.com/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey-gov.com/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    // swiftlint:disable:next line_length
                    string: "https://vault.vowkey-gov.com/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://vault.vowkey-gov.com")!,
            ),
        )
    }

    /// `init(environmentURLData:)` defaults to the pre-defined government cloud (FedRAMP) URLs if the
    /// base URL matches the gov environment.
    @Test
    func init_environmentURLData_baseURL_gov() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData(base: URL(string: "https://vault.vowkey-gov.com")!),
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://api.vowkey-gov.com")!,
                baseURL: URL(string: "https://vault.vowkey-gov.com")!,
                changeEmailURL: URL(string: "https://vault.vowkey-gov.com/#/settings/account")!,
                eventsURL: URL(string: "https://events.vowkey-gov.com")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://icons.vowkey-gov.com")!,
                identityURL: URL(string: "https://identity.vowkey-gov.com")!,
                importItemsURL: URL(string: "https://vault.vowkey-gov.com/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey-gov.com/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://vault.vowkey-gov.com/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://vault.vowkey-gov.com/#/recover-2fa")!,
                sendShareURL: URL(string: "https://send.vowkey-gov.com/#")!,
                settingsURL: URL(string: "https://vault.vowkey-gov.com/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey-gov.com/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    // swiftlint:disable:next line_length
                    string: "https://vault.vowkey-gov.com/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://vault.vowkey-gov.com")!,
            ),
        )
    }
}
