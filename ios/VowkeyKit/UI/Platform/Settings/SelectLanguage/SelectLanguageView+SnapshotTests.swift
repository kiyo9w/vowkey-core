// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

// MARK: - SelectLanguageViewTests

class SelectLanguageViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<SelectLanguageState, SelectLanguageAction, Void>!
    var subject: SelectLanguageView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(state: SelectLanguageState())
        let store = Store(processor: processor)

        subject = SelectLanguageView(store: store)
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// Test that the default view renders correctly.
    func disabletest_snapshot_default() {
        assertSnapshots(
            of: subject.navStackWrapped,
            as: [
                .defaultPortrait,
                .defaultPortraitDark,
                .tallPortraitAX5(),
            ],
        )
    }
}
