// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import SwiftUI
import XCTest

@testable import VowkeyShared

// MARK: - ExpiredLinkViewTests

class ExpiredLinkViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<ExpiredLinkState, ExpiredLinkAction, Void>!
    var subject: ExpiredLinkView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()
        processor = MockProcessor(state: ExpiredLinkState())
        subject = ExpiredLinkView(store: Store(processor: processor))
    }

    override func tearDown() {
        super.tearDown()
        processor = nil
        subject = nil
    }

    // MARK: Tests

    /// Tests the view renders correctly.
    @MainActor
    func disabletest_snapshot_toggles_on() throws {
        assertSnapshots(of: subject, as: [.defaultPortrait, .defaultPortraitDark, .defaultPortraitAX5])
    }
}
