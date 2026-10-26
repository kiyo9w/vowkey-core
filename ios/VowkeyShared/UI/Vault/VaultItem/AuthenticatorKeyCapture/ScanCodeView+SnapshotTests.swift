// swiftlint:disable:this file_name
import AVFoundation
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

@testable import VowkeyShared

// MARK: - ScanCodeViewTests

class ScanCodeViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<ScanCodeState, ScanCodeAction, ScanCodeEffect>!
    var subject: ScanCodeView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()
        processor = MockProcessor(state: .init())
        let store = Store(processor: processor)
        subject = ScanCodeView(
            cameraSession: .init(),
            store: store,
        )
    }

    override func tearDown() {
        super.tearDown()
        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// Test a snapshot of the ProfileSwitcherView previews.
    func disabletest_snapshot_scanCodeView_previews() {
        for preview in ScanCodeView_Previews._allPreviews {
            assertSnapshots(
                of: preview.content,
                as: [
                    .defaultPortrait,
                    .defaultLandscape,
                    .defaultPortraitAX5,
                ],
            )
        }
    }
}
