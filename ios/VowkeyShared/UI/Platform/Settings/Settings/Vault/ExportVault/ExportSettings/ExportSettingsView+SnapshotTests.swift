// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

@testable import VowkeyShared

class ExportSettingsViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<Void, ExportSettingsAction, Void>!
    var subject: ExportSettingsView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(state: ())
        let store = Store(processor: processor)

        subject = ExportSettingsView(store: store)
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// The default view renders correctly.
    @MainActor
    func disabletest_snapshot_default() {
        assertSnapshots(of: subject, as: [.defaultPortrait, .defaultPortraitDark, .defaultPortraitAX5])
    }
}
