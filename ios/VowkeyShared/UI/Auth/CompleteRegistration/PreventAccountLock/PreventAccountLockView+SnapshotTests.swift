// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

@testable import VowkeyShared

class PreventAccountLockViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<Void, PreventAccountLockAction, Void>!
    var subject: PreventAccountLockView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(state: ())
        subject = PreventAccountLockView(store: Store(processor: processor))
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// The prevent account lock view renders correctly.
    @MainActor
    func disabletest_snapshot_preventAccountLock() {
        assertSnapshots(
            of: subject.navStackWrapped,
            as: [.defaultPortrait, .defaultPortraitDark, .tallPortraitAX5(heightMultiple: 2), .defaultLandscape],
        )
    }
}
