// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

// MARK: - AppearanceViewTests

@testable import VowkeyShared

class AppearanceViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<AppearanceState, AppearanceAction, AppearanceEffect>!
    var subject: AppearanceView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(state: AppearanceState())
        let store = Store(processor: processor)

        subject = AppearanceView(store: store)
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// Tests the view renders correctly.
    func disabletest_snapshot_viewRender() {
        assertSnapshots(
            of: subject,
            as: [.defaultPortrait, .defaultPortraitDark, .defaultPortraitAX5],
        )
    }
}
