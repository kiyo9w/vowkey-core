import VowkeyKitMocks
import SwiftUI
import XCTest

@testable import VowkeyShared

class PreventAccountLockProcessorTests: VowkeyTestCase {
    // MARK: Properties

    var coordinator: MockCoordinator<AuthRoute, AuthEvent>!
    var subject: PreventAccountLockProcessor!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        coordinator = MockCoordinator()

        subject = PreventAccountLockProcessor(coordinator: coordinator.asAnyCoordinator())
    }

    override func tearDown() {
        super.tearDown()

        coordinator = nil
        subject = nil
    }

    // MARK: Tests

    /// `receive(_:)` with `.dismiss` dismisses the view.
    @MainActor
    func test_receive_dismiss() {
        subject.receive(.dismiss)
        XCTAssertEqual(coordinator.routes.last, .dismissPresented)
    }
}
