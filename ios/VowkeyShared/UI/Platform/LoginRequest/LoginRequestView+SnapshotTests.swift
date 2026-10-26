// swiftlint:disable:this file_name
import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import SnapshotTesting
import XCTest

@testable import VowkeyShared

// MARK: - ViewItemViewTests

class LoginRequestViewTests: VowkeyTestCase {
    // MARK: Properties

    var processor: MockProcessor<LoginRequestState, LoginRequestAction, LoginRequestEffect>!
    var subject: LoginRequestView!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        processor = MockProcessor(state: LoginRequestState(request: .fixture(
            fingerprintPhrase: "i-asked-chat-gpt-but-it-said-no",
        )))
        let store = Store(processor: processor)

        subject = LoginRequestView(store: store)
    }

    override func tearDown() {
        super.tearDown()

        processor = nil
        subject = nil
    }

    // MARK: Snapshots

    /// The default view renders correctly.
    func disabletest_snapshot() {
        assertSnapshots(
            of: subject.navStackWrapped,
            as: [
                .defaultPortrait,
                .defaultPortraitDark,
                .tallPortraitAX5(heightMultiple: 2),
            ],
        )
    }
}
