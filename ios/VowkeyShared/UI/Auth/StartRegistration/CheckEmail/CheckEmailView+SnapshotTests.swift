// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import SwiftUI
import XCTest

@testable import VowkeyShared

// MARK: - CheckEmailViewTests

class CheckEmailViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<CheckEmailState, CheckEmailAction, Void>!
    var subject: CheckEmailView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()
        processor = MockProcessor(state: CheckEmailState(email: "example@email.com"))
        let store = Store(processor: processor)
        subject = CheckEmailView(store: store)
    }

    override func tearDown() {
        super.tearDown()
        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// Tests the view renders correctly.
    func disabletest_snapshot_empty() {
        assertSnapshots(
            of: subject,
            as: [
                .defaultPortrait,
                .defaultPortraitDark,
                .tallPortraitAX5(heightMultiple: 2),
            ],
        )
    }
}
