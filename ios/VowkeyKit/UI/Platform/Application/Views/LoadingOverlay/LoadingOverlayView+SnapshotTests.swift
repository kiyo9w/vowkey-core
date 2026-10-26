// swiftlint:disable:this file_name
import SnapshotTesting
import TestHelpers
import XCTest

@testable import VowkeyKit

class LoadingOverlayViewTests: VowkeyTestCase {
    // MARK: Tests

    /// Test a snapshot of the loading overlay.
    func disabletest_snapshot_loadingOverlay() {
        assertSnapshots(
            of: LoadingOverlayView(state: .init(title: "Loading...")),
            as: [.defaultPortrait, .defaultPortraitDark],
        )
    }
}
