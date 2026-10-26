import XCTest

@testable import VowkeyShared

// MARK: - SendTypeTests

class SendTypeTests: VowkeyTestCase {
    // MARK: Tests

    /// `requiresPremium` returns the correct value for each type.
    func test_requiresPremium() {
        XCTAssertTrue(SendType.file.requiresPremium)
        XCTAssertFalse(SendType.text.requiresPremium)
    }
}
