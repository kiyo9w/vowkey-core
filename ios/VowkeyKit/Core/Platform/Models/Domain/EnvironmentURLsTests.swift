import Foundation
import Testing

@testable import VowkeyKit

struct EnvironmentURLsTests { // swiftlint:disable:this type_body_length
    // MARK: Tests

    /// `init(environmentURLData:)` sets the URLs from the passed data when such data is the default US.
    @Test
    func init_environmentURLData_defaultUS() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData.defaultUS,
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://vault.vowkey.app/api")!,
                baseURL: URL(string: "https://vault.vowkey.app")!,
                changeEmailURL: URL(string: "https://vault.vowkey.app/#/settings/account")!,
                eventsURL: URL(string: "https://vault.vowkey.app/events")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://vault.vowkey.app/icons")!,
                identityURL: URL(string: "https://vault.vowkey.app/identity")!,
                importItemsURL: URL(string: "https://vault.vowkey.app/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey.app/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://vault.vowkey.app/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://vault.vowkey.app/#/recover-2fa")!,
                sendShareURL: URL(string: "https://vault.vowkey.app/#/send")!,
                settingsURL: URL(string: "https://vault.vowkey.app/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey.app/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://vault.vowkey.app/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://vault.vowkey.app")!,
            ),
        )
    }

    /// `init(environmentURLData:)` sets the URLs from the passed data when such data is the default EU.
    @Test
    func init_environmentURLData_defaultEU() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData.defaultEU,
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://api.vowkey.eu")!,
                baseURL: URL(string: "https://vault.vowkey.eu")!,
                changeEmailURL: URL(string: "https://vault.vowkey.eu/#/settings/account")!,
                eventsURL: URL(string: "https://events.vowkey.eu")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://icons.vowkey.eu")!,
                identityURL: URL(string: "https://identity.vowkey.eu")!,
                importItemsURL: URL(string: "https://vault.vowkey.eu/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey.eu/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://vault.vowkey.eu/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://vault.vowkey.eu/#/recover-2fa")!,
                sendShareURL: URL(string: "https://vault.vowkey.eu/#/send")!,
                settingsURL: URL(string: "https://vault.vowkey.eu/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey.eu/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://vault.vowkey.eu/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://vault.vowkey.eu")!,
            ),
        )
    }

    /// `init(environmentURLData:)` sets the URLs from the base URL if one is set and is not
    /// `.unitedStates` nor `.europe` region type.
    @Test
    func init_environmentURLData_baseURL() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData(base: URL(string: "https://example.com")!),
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://example.com/api")!,
                baseURL: URL(string: "https://example.com")!,
                changeEmailURL: URL(string: "https://example.com/#/settings/account")!,
                eventsURL: URL(string: "https://example.com/events")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://example.com/icons")!,
                identityURL: URL(string: "https://example.com/identity")!,
                importItemsURL: URL(string: "https://example.com/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://example.com/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://example.com/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://example.com/#/recover-2fa")!,
                sendShareURL: URL(string: "https://example.com/#/send")!,
                settingsURL: URL(string: "https://example.com/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://example.com/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://example.com/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://example.com")!,
            ),
        )
    }

    /// `init(environmentURLData:)` defaults to the pre-defined EU URLs if the base URL matches the EU environment.
    @Test
    func init_environmentURLData_baseURL_europe() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData(base: URL(string: "https://vault.vowkey.eu")!),
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://api.vowkey.eu")!,
                baseURL: URL(string: "https://vault.vowkey.eu")!,
                changeEmailURL: URL(string: "https://vault.vowkey.eu/#/settings/account")!,
                eventsURL: URL(string: "https://events.vowkey.eu")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://icons.vowkey.eu")!,
                identityURL: URL(string: "https://identity.vowkey.eu")!,
                importItemsURL: URL(string: "https://vault.vowkey.eu/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey.eu/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://vault.vowkey.eu/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://vault.vowkey.eu/#/recover-2fa")!,
                sendShareURL: URL(string: "https://vault.vowkey.eu/#/send")!,
                settingsURL: URL(string: "https://vault.vowkey.eu/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey.eu/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://vault.vowkey.eu/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://vault.vowkey.eu")!,
            ),
        )
    }

    /// `init(environmentURLData:)` defaults to the pre-defined US URLs if the base URL matches the US environment.
    @Test
    func init_environmentURLData_baseURL_unitedStates() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData(base: URL(string: "https://vault.vowkey.app")!),
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://vault.vowkey.app/api")!,
                baseURL: URL(string: "https://vault.vowkey.app")!,
                changeEmailURL: URL(string: "https://vault.vowkey.app/#/settings/account")!,
                eventsURL: URL(string: "https://vault.vowkey.app/events")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://vault.vowkey.app/icons")!,
                identityURL: URL(string: "https://vault.vowkey.app/identity")!,
                importItemsURL: URL(string: "https://vault.vowkey.app/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey.app/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://vault.vowkey.app/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://vault.vowkey.app/#/recover-2fa")!,
                sendShareURL: URL(string: "https://vault.vowkey.app/#/send")!,
                settingsURL: URL(string: "https://vault.vowkey.app/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey.app/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://vault.vowkey.app/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://vault.vowkey.app")!,
            ),
        )
    }

    /// `init(environmentURLData:)` sets the URLs from the base URL which includes a trailing slash.
    @Test
    func init_environmentURLData_baseURLWithTrailingSlash() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData(base: URL(string: "https://example.com/")!),
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://example.com/api")!,
                baseURL: URL(string: "https://example.com/")!,
                changeEmailURL: URL(string: "https://example.com/#/settings/account")!,
                eventsURL: URL(string: "https://example.com/events")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://example.com/icons")!,
                identityURL: URL(string: "https://example.com/identity")!,
                importItemsURL: URL(string: "https://example.com/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://example.com/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://example.com/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://example.com/#/recover-2fa")!,
                sendShareURL: URL(string: "https://example.com/#/send")!,
                settingsURL: URL(string: "https://example.com/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://example.com/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://example.com/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://example.com/")!,
            ),
        )
    }

    /// `init(environmentURLData:)` sets the URLs based on the corresponding URL if there isn't a base URL.
    @Test
    func init_environmentURLData_custom() {
        let subject = EnvironmentURLs(
            environmentURLData: EnvironmentURLData(
                api: URL(string: "https://api.example.com")!,
                events: URL(string: "https://events.example.com")!,
                icons: URL(string: "https://icons.example.com")!,
                identity: URL(string: "https://identity.example.com")!,
                webVault: URL(string: "https://example.com")!,
            ),
        )
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://api.example.com")!,
                baseURL: URL(string: "https://vault.vowkey.app")!,
                changeEmailURL: URL(string: "https://example.com/#/settings/account")!,
                eventsURL: URL(string: "https://events.example.com")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://icons.example.com")!,
                identityURL: URL(string: "https://identity.example.com")!,
                importItemsURL: URL(string: "https://example.com/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://example.com/#/settings/subscription")!,
                proxyCookieRedirectConnectorURL: URL(
                    string: "https://example.com/proxy-cookie-redirect-connector.html",
                )!,
                recoveryCodeURL: URL(string: "https://example.com/#/recover-2fa")!,
                sendShareURL: URL(string: "https://example.com/#/send")!,
                settingsURL: URL(string: "https://example.com/#/settings")!,
                setUpTwoFactorURL: URL(string: "https://example.com/#/settings/security/two-factor")!,
                upgradeToPremiumURL: URL(
                    string: "https://example.com/#/settings/subscription/premium?callToAction=upgradeToPremium",
                )!,
                webVaultURL: URL(string: "https://example.com")!,
            ),
        )
    }

    /// `init(environmentURLData:)` sets the URLs to default values if the URLs are empty.
    @Test
    func init_environmentURLData_empty() {
        let subject = EnvironmentURLs(environmentURLData: EnvironmentURLData())
        #expect(
            subject == EnvironmentURLs(
                apiURL: URL(string: "https://vault.vowkey.app/api")!,
                baseURL: URL(string: "https://vault.vowkey.app")!,
                changeEmailURL: URL(string: "https://vault.vowkey.app")!,
                eventsURL: URL(string: "https://vault.vowkey.app/events")!,
                fillAssistRulesURL: URL(string: "https://fillassist.vowkey.app")!,
                iconsURL: URL(string: "https://vault.vowkey.app/icons")!,
                identityURL: URL(string: "https://vault.vowkey.app/identity")!,
                importItemsURL: URL(string: "https://vault.vowkey.app/#/tools/import")!,
                manageSubscriptionURL: URL(string: "https://vault.vowkey.app")!,
                proxyCookieRedirectConnectorURL: URL(string: "https://vault.vowkey.app")!,
                recoveryCodeURL: URL(string: "https://vault.vowkey.app/#/recover-2fa")!,
                sendShareURL: URL(string: "https://vault.vowkey.app/#/send")!,
                settingsURL: URL(string: "https://vault.vowkey.app")!,
                setUpTwoFactorURL: URL(string: "https://vault.vowkey.app")!,
                upgradeToPremiumURL: URL(string: "https://vault.vowkey.app")!,
                webVaultURL: URL(string: "https://vault.vowkey.app")!,
            ),
        )
    }

    /// `init(environmentURLData:)` preserves a server-provided `fillAssistRulesUrl` even when the
    /// region maps to a US/EU default (which has `fillAssistRulesUrl = nil`).
    @Test
    func init_environmentURLData_fillAssistRulesURL_preservedForCloudRegion() {
        let customFillAssistURL = URL(string: "https://custom.example.com/fill-assist")!
        let usData = EnvironmentURLData(
            base: URL(string: "https://vault.vowkey.app")!,
            fillAssistRulesUrl: customFillAssistURL,
        )

        let subject = EnvironmentURLs(environmentURLData: usData)

        #expect(subject.fillAssistRulesURL == customFillAssistURL)
    }

    /// `region` resolves the base URL to the matching region.
    @Test
    func region() {
        #expect(EnvironmentURLs(environmentURLData: .defaultUS).region == .unitedStates)
        #expect(EnvironmentURLs(environmentURLData: .defaultEU).region == .europe)
        #expect(
            EnvironmentURLs(environmentURLData: EnvironmentURLData(base: URL(string: "https://vowkey.pw")!))
                .region == .internal,
        )
        #expect(
            EnvironmentURLs(
                environmentURLData: EnvironmentURLData(base: URL(string: "https://selfhosted.com")!),
            ).region == .selfHosted,
        )
    }
}
