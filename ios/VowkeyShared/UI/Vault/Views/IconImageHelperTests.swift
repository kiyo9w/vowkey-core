import VowkeySdk
import XCTest

@testable import VowkeyShared

final class IconImageHelperTests: VowkeyTestCase {
    // MARK: Parameters

    let defaultURL = URL(string: "https://icons.vowkey.net")!

    // MARK: Tests

    func test_getIconImage_emptyURIs() {
        let loginView = VowkeySdk.LoginView.fixture(
            uris: [],
        )
        let result = IconImageHelper.getIconImage(for: loginView, from: defaultURL)
        XCTAssertNil(result)
    }

    func test_getIconImage_nilURIs() {
        let loginView = VowkeySdk.LoginView.fixture()
        let result = IconImageHelper.getIconImage(for: loginView, from: defaultURL)
        XCTAssertNil(result)
    }

    func test_getIconImage_nilURL() {
        let loginView = VowkeySdk.LoginView.fixture(
            uris: [
                .fixture(uri: "vowkey.com", match: nil),
            ],
        )
        let result = IconImageHelper.getIconImage(for: loginView, from: defaultURL)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.absoluteString, "https://icons.vowkey.net/vowkey.com/icon.png")
    }

    func test_getIconImage_multiURI() {
        let loginView = VowkeySdk.LoginView.fixture(
            uris: [
                .fixture(uri: nil, match: nil),
                .fixture(uri: "://peanuts", match: nil),
                .fixture(uri: "://peanuts.yum", match: nil),
                .fixture(uri: "vowkey.com", match: nil),
            ],
        )
        let result = IconImageHelper.getIconImage(for: loginView, from: defaultURL)
        XCTAssertNotNil(result)
        XCTAssertEqual(result?.absoluteString, "https://icons.vowkey.net/vowkey.com/icon.png")
    }
}
