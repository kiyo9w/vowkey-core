import XCTest

@testable import VowkeyShared

class SecureNoteTypeTests: VowkeyTestCase {
    /// `defaultValue` returns the default value for the type if an invalid or missing value is
    /// received when decoding the type.
    func test_defaultValue() {
        XCTAssertEqual(SecureNoteType.defaultValue, .generic)
    }
}
