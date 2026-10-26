// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
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

    // MARK: Snapshots

    /// The import logins success page renders correctly.
    @MainActor
    func disabletest_snapshot_importLoginsSuccess() {
        assertSnapshots(
            of: subject.navStackWrapped,
            as: [.defaultPortrait, .defaultPortraitDark, .tallPortraitAX5(heightMultiple: 3), .defaultLandscape],
        )
    }
}
