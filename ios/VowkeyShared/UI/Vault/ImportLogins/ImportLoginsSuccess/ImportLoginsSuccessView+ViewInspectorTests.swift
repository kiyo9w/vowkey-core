// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import ViewInspector
import XCTest

@testable import VowkeyShared

class ImportLoginsSuccessViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<Void, Void, ImportLoginsSuccessEffect>!
    var subject: ImportLoginsSuccessView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(state: ())

        subject = ImportLoginsSuccessView(store: Store(processor: processor))
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Tests

    /// Tapping the close button dispatches the `dismiss` action.
    @MainActor
    func test_close_tap() throws {
        let button = try subject.inspect().findCloseToolbarButton()
        try button.tap()
        waitFor { !processor.effects.isEmpty }
        XCTAssertEqual(processor.effects.last, .dismiss)
    }

    /// Tapping the got it button dispatches the `dismiss` action.
    @MainActor
    func test_gotIt_tap() async throws {
        let button = try subject.inspect().find(asyncButton: Localizations.gotIt)
        try await button.tap()
        XCTAssertEqual(processor.effects.last, .dismiss)
    }
}
