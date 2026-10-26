// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import ViewInspector
import XCTest

@testable import AuthenticatorShared

// MARK: - ManualEntryViewTests

class ManualEntryViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<ManualEntryState, ManualEntryAction, ManualEntryEffect>!
    var subject: ManualEntryView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()
        processor = MockProcessor(state: DefaultEntryState(deviceSupportsCamera: true))
        let store = Store(processor: processor)
        subject = ManualEntryView(
            store: store,
        )
    }

    override func tearDown() {
        super.tearDown()
        processor = nil
        subject = nil
    }

    // MARK: Tests

    /// Tapping the add local code button dispatches the `.addPressed(:)` action.
    @MainActor
    func test_addButton_tap_empty() throws {
        let button = try subject.inspect().find(button: Localizations.addCode)
        try button.tap()
        XCTAssertEqual(
            processor.dispatchedActions.last,
            .addPressed(code: "", name: "", sendToVowkey: false),
        )
    }

    /// Tapping the add local code button dispatches the `.addPressed(:)` action.
    @MainActor
    func test_addButton_tap_new() throws {
        processor.state.name = "wayne"
        processor.state.authenticatorKey = "pasta-batman"
        let button = try subject.inspect().find(button: Localizations.addCode)
        try button.tap()
        XCTAssertEqual(
            processor.dispatchedActions.last,
            .addPressed(code: "pasta-batman", name: "wayne", sendToVowkey: false),
        )
    }

    /// Tapping the Save here button dispatches the `.addPressed(:)` action.
    @MainActor
    func test_addLocallyButton_tap_empty() throws {
        processor.state.isPasswordManagerSyncActive = true
        let button = try subject.inspect().find(button: Localizations.saveHere)
        try button.tap()
        XCTAssertEqual(
            processor.dispatchedActions.last,
            .addPressed(code: "", name: "", sendToVowkey: false),
        )
    }

    /// Tapping the Save here button dispatches the `.addPressed(:)` action.
    @MainActor
    func test_addLocallyButton_tap_textEntered() throws {
        processor.state.name = "wayne"
        processor.state.authenticatorKey = "pasta-batman"
        processor.state.isPasswordManagerSyncActive = true
        let button = try subject.inspect().find(button: Localizations.saveHere)
        try button.tap()
        XCTAssertEqual(
            processor.dispatchedActions.last,
            .addPressed(code: "pasta-batman", name: "wayne", sendToVowkey: false),
        )
    }

    /// Tapping the add to Vowkey button dispatches the `.addPressed(:)` action.
    @MainActor
    func test_addToVowkeyButton_tap_empty() throws {
        processor.state.isPasswordManagerSyncActive = true
        let button = try subject.inspect().find(button: Localizations.saveToVowkey)
        try button.tap()
        XCTAssertEqual(
            processor.dispatchedActions.last,
            .addPressed(code: "", name: "", sendToVowkey: true),
        )
    }

    /// Tapping the add to Vowkey button dispatches the `.addPressed(:)` action.
    @MainActor
    func test_addToVowkeyButton_tap_textEntered() throws {
        processor.state.name = "wayne"
        processor.state.authenticatorKey = "pasta-batman"
        processor.state.isPasswordManagerSyncActive = true
        let button = try subject.inspect().find(button: Localizations.saveToVowkey)
        try button.tap()
        XCTAssertEqual(
            processor.dispatchedActions.last,
            .addPressed(code: "pasta-batman", name: "wayne", sendToVowkey: true),
        )
    }

    /// Tapping the cancel button dispatches the `.dismiss` action.
    @MainActor
    func test_closeButton_tap() throws {
        let button = try subject.inspect().findCancelToolbarButton()
        try button.tap()
        XCTAssertEqual(processor.dispatchedActions.last, .dismissPressed)
    }

    /// Tapping the scan code button dispatches the `.scanCodePressed` action.
    @MainActor
    func test_scanCodeButton_tap() throws {
        let button = try subject.inspect().find(
            button: Localizations.cannotAddAuthenticatorKey + " " + Localizations.scanQRCode,
        )
        try button.tap()
        waitFor(!processor.effects.isEmpty)

        XCTAssertEqual(processor.effects.last, .scanCodePressed)
    }
}
