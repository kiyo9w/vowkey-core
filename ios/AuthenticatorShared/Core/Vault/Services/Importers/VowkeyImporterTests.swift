import AuthenticatorSharedMocks
import XCTest

@testable import AuthenticatorShared

final class VowkeyImporterTests: VowkeyTestCase {
    /// Can import Vowkey JSON
    func test_raivoImport() throws {
        let data = ImportTestData.vowkeyJson.data
        let expected = [
            AuthenticatorItemView(
                favorite: false,
                id: "One",
                name: "Name",
                totpKey: "otpauth://totp/Vowkey:person@example.com?secret=EXAMPLE&issuer=Vowkey",
                username: "person@example.com",
            ),
            AuthenticatorItemView(
                favorite: true,
                id: "Two",
                name: "Steam",
                totpKey: "steam://EXAMPLE",
                username: "person@example.com",
            ),
        ]
        let actual = try VowkeyImporter.importItems(data: data)
        XCTAssertEqual(actual, expected)
    }
}
