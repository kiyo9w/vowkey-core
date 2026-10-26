import VowkeyResources
import XCTest

@testable import AuthenticatorShared

class DefaultSaveOptionTests: VowkeyTestCase {
    // MARK: Tests

    /// `allCases` returns all of the cases in the correct order.
    func test_allCases() {
        XCTAssertEqual(
            DefaultSaveOption.allCases,
            [
                .saveToVowkey,
                .saveHere,
                .none,
            ],
        )
    }

    /// `localizedName` returns the correct values.
    func test_localizedName() {
        XCTAssertEqual(DefaultSaveOption.none.localizedName, Localizations.none)
        XCTAssertEqual(DefaultSaveOption.saveHere.localizedName, Localizations.saveHere)
        XCTAssertEqual(DefaultSaveOption.saveToVowkey.localizedName, Localizations.saveToVowkey)
    }

    /// `rawValue` returns the correct values.
    func test_rawValues() {
        XCTAssertEqual(DefaultSaveOption.none.rawValue, "none")
        XCTAssertEqual(DefaultSaveOption.saveHere.rawValue, "saveHere")
        XCTAssertEqual(DefaultSaveOption.saveToVowkey.rawValue, "saveToVowkey")
    }
}
