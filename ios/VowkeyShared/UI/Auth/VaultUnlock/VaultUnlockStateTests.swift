import VowkeyKit
import XCTest

@testable import VowkeyShared
@testable import VowkeySharedMocks

class VaultUnlockStateTests: VowkeyTestCase {
    // MARK: Tests

    /// `init(account:)` uses the accounts email and web vault host to populate the state.
    func test_init_account() {
        let subject = VaultUnlockState(
            account: .fixture(
                settings: .fixture(
                    environmentURLs: .fixture(
                        webVault: URL(string: "https://test.vowkey.com"),
                    ),
                ),
            ),
        )

        XCTAssertEqual(subject.email, "user@bitwarden.com")
        XCTAssertEqual(subject.webVaultHost, "test.vowkey.com")
    }

    /// `init(account:)` uses the accounts email and web vault host to populate the state. The web
    /// vault host defaults to vowkey.com if the account URL is `nil`.
    func test_init_account_nilWebVaultHost() {
        let subject = VaultUnlockState(
            account: .fixture(
                settings: .fixture(
                    environmentURLs: .fixture(
                        base: nil,
                        webVault: nil,
                    ),
                ),
            ),
        )

        XCTAssertEqual(subject.email, "user@bitwarden.com")
        XCTAssertEqual(subject.webVaultHost, Constants.defaultWebVaultHost)
    }
}
