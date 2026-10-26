// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

@testable import VowkeyShared

class LoginDecryptionOptionsViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<
        LoginDecryptionOptionsState,
        LoginDecryptionOptionsAction,
        LoginDecryptionOptionsEffect,
    >!
    var subject: LoginDecryptionOptionsView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(
            state: LoginDecryptionOptionsState(
                shouldShowApproveMasterPasswordButton: true,
                shouldShowApproveWithOtherDeviceButton: true,
                shouldShowContinueButton: true,
                email: "example@bitwarden.com",
                isRememberDeviceToggleOn: true,
                orgIdentifier: "Vowkey",
                shouldShowAdminApprovalButton: true,
            ),
        )
        let store = Store(processor: processor)

        subject = LoginDecryptionOptionsView(store: store)
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
