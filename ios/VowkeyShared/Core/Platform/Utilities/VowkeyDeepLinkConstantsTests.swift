import XCTest

@testable import VowkeyShared

class VowkeyDeepLinkConstantsTests: VowkeyTestCase {
    // MARK: Tests

    /// `accountSecurity` has the expected deep link value.
    func test_accountSecurity_value() {
        XCTAssertEqual(VowkeyDeepLinkConstants.accountSecurity, "vowkey://settings/account_security")
    }

    /// `authenticatorNewItem` has the expected deep link value.
    func test_authenticatorNewItem_value() {
        XCTAssertEqual(VowkeyDeepLinkConstants.authenticatorNewItem, "vowkey://authenticator/newItem")
    }

    /// `ssoCookieVendor` has the expected deep link base URL.
    func test_ssoCookieVendor_value() {
        XCTAssertEqual(VowkeyDeepLinkConstants.ssoCookieVendor, "vowkey://sso-cookie-vendor")
    }
}
