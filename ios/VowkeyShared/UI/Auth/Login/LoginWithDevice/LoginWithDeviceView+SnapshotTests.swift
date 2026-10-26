// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

@testable import VowkeyShared

class LoginWithDeviceViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<LoginWithDeviceState, LoginWithDeviceAction, LoginWithDeviceEffect>!
    var subject: LoginWithDeviceView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(
            state: LoginWithDeviceState(
                fingerprintPhrase: "some-weird-long-text-thing-as-a-placeholder",
            ),
        )
        let store = Store(processor: processor)

        subject = LoginWithDeviceView(store: store)
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// The default view renders correctly.
    func disabletest_snapshot_default() {
        assertSnapshots(of: subject, as: [.defaultPortrait, .defaultPortraitDark, .defaultPortraitAX5])
    }
}
