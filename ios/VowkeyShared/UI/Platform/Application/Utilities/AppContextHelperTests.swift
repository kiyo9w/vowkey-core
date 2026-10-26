import XCTest

@testable import VowkeyShared

// MARK: - AppContextHelperTests

class AppContextHelperTests: VowkeyTestCase {
    // MARK: Properties

    var subject: AppContextHelper!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        subject = DefaultAppContextHelper(appContext: .appExtension)
    }

    override func tearDown() {
        super.tearDown()

        subject = nil
    }

    // MARK: Tests

    /// `getter:appContext` returns the current app context from the helper.
    func test_appContext() {
        XCTAssertEqual(subject.appContext, .appExtension)
    }
}
