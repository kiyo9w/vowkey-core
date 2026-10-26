import VowkeyKitMocks
import SwiftUI
import XCTest

@testable import VowkeyShared

// MARK: - ExtensionSetupCoordinatorTests

class ExtensionSetupCoordinatorTests: VowkeyTestCase {
    // MARK: Properties

    var stackNavigator: MockStackNavigator!
    var subject: ExtensionSetupCoordinator!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        stackNavigator = MockStackNavigator()
        subject = ExtensionSetupCoordinator(
            appExtensionDelegate: MockAppExtensionDelegate(),
            services: ServiceContainer.withMocks(),
            stackNavigator: stackNavigator,
        )
    }

    override func tearDown() {
        super.tearDown()

        stackNavigator = nil
        subject = nil
    }

    // MARK: Tests

    /// `navigate(to:)` with `.extensionActivation` replaces the stack navigator's stack with the
    /// extension activation view.
    @MainActor
    func test_navigateTo_extensionActivation() throws {
        subject.navigate(to: .extensionActivation(type: .autofillExtension))

        let action = try XCTUnwrap(stackNavigator.actions.last)
        XCTAssertEqual(action.type, .replaced)
        XCTAssertTrue(action.view is ExtensionActivationView)
    }
}
