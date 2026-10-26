import VowkeyKit
import Foundation

@testable import VowkeyShared

extension EnvironmentURLData {
    static func fixture(
        api: URL? = nil,
        base: URL? = URL(string: "https://vault.vowkey.com"),
        events: URL? = nil,
        icons: URL? = nil,
        identity: URL? = nil,
        notifications: URL? = nil,
        webVault: URL? = nil,
    ) -> EnvironmentURLData {
        EnvironmentURLData(
            api: api,
            base: base,
            events: events,
            icons: icons,
            identity: identity,
            notifications: notifications,
            webVault: webVault,
        )
    }
}
