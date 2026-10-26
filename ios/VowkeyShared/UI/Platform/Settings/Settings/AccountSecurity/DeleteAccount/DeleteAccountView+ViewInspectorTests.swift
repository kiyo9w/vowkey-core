// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import ViewInspector
import XCTest

@testable import VowkeyShared

class DeleteAccountViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<DeleteAccountState, DeleteAccountAction, DeleteAccountEffect>!
    var subject: DeleteAccountView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()
        processor = MockProcessor(state: DeleteAccountState())

        let store = Store(processor: processor)
        subject = DeleteAccountView(store: store)
    }

    override func tearDown() {
        super.tearDown()
        processor = nil
        subject = nil
    }

    // MARK: Tests

    /// Tapping the delete account button performs the `.deleteAccount` effect.
    @MainActor
    func test_deleteAccount_tap() async throws {
        let button = try subject.inspect().find(asyncButton: Localizations.deleteAccount)
        try await button.tap()

        XCTAssertEqual(processor.effects.last, .deleteAccount)
    }
}
