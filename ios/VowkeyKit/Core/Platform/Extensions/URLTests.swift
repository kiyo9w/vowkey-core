import XCTest

@testable import VowkeyKit

class URLTests: VowkeyTestCase {
    // MARK: Tests

    /// `isIPAddress` returns `true` when the URL is an IP Address, `false` otherwise.
    func test_isIPAddress() {
        XCTAssertFalse(URL(string: "https://localhost")?.isIPAddress == true)
        XCTAssertFalse(URL(string: "https://localhost/test")?.isIPAddress == true)
        XCTAssertTrue(URL(string: "https://1.1.1.1")?.isIPAddress == true)
        XCTAssertTrue(URL(string: "http://192.168.0.1")?.isIPAddress == true)
        XCTAssertTrue(URL(string: "http://192.168.0.1:8080")?.isIPAddress == true)

        XCTAssertFalse(URL(string: "https://example.com")?.isIPAddress == true)
        XCTAssertFalse(URL(string: "https://example.co.uk")?.isIPAddress == true)
    }

    /// `sanitized` prepends a https scheme if the URL is missing a scheme.
    func test_sanitized_missingScheme() {
        XCTAssertEqual(
            URL(string: "vowkey.com")?.sanitized,
            URL(string: "https://vowkey.com"),
        )
        XCTAssertEqual(
            URL(string: "example.com")?.sanitized,
            URL(string: "https://example.com"),
        )
        XCTAssertEqual(
            URL(string: "vault.vowkey.com/#/vault")?.sanitized,
            URL(string: "https://vault.vowkey.com/#/vault"),
        )
        XCTAssertEqual(
            URL(string: "google.com/search?q=vowkey")?.sanitized,
            URL(string: "https://google.com/search?q=vowkey"),
        )
    }

    /// `sanitized` removes a trailing slash from the URL.
    func test_sanitized_trailingSlash() {
        XCTAssertEqual(
            URL(string: "https://vowkey.com/")?.sanitized,
            URL(string: "https://vowkey.com"),
        )
        XCTAssertEqual(
            URL(string: "example.com/")?.sanitized,
            URL(string: "https://example.com"),
        )
    }

    /// `sanitized` returns the URL unchanged if it's valid and contains a scheme.
    func test_sanitized_validURL() {
        XCTAssertEqual(
            URL(string: "https://vowkey.com")?.sanitized,
            URL(string: "https://vowkey.com"),
        )
        XCTAssertEqual(
            URL(string: "http://vowkey.com")?.sanitized,
            URL(string: "http://vowkey.com"),
        )
        XCTAssertEqual(
            URL(string: "https://vault.vowkey.com/#/vault")?.sanitized,
            URL(string: "https://vault.vowkey.com/#/vault"),
        )
        XCTAssertEqual(
            URL(string: "https://google.com/search?q=vowkey")?.sanitized,
            URL(string: "https://google.com/search?q=vowkey"),
        )
    }

    /// `withoutScheme` returns a string of the URL with the scheme removed.
    func test_withoutScheme() {
        XCTAssertEqual(URL(string: "https://vowkey.com")?.withoutScheme, "vowkey.com")
        XCTAssertEqual(URL(string: "https://vowkey.com/vault")?.withoutScheme, "vowkey.com/vault")
        XCTAssertEqual(
            URL(string: "https://vowkey.com/vault?q=https://vowkey.com")?.withoutScheme,
            "vowkey.com/vault?q=https://vowkey.com",
        )
        XCTAssertEqual(URL(string: "https://send.vowkey.com/39ngaol3")?.withoutScheme, "send.vowkey.com/39ngaol3")
        XCTAssertEqual(URL(string: "send.vowkey.com/39ngaol3")?.withoutScheme, "send.vowkey.com/39ngaol3")
    }
}
