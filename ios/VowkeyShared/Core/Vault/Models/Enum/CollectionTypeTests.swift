import XCTest

@testable import VowkeyShared

class CollectionTypeTests: VowkeyTestCase {
    /// `defaultValue` returns the default value for the type.
    func test_defaultValue() {
        XCTAssertEqual(CollectionType.defaultValue, .sharedCollection)
    }
}
