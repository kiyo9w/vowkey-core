import VowkeyKit
import VowkeyKitMocks
import VowkeyResources
import TestHelpers
import XCTest

// swiftlint:disable file_length

@testable import VowkeyShared
@testable import VowkeySharedMocks

class SettingsProcessorTests: VowkeyTestCase { // swiftlint:disable:this type_body_length
    // MARK: Properties

    var billingService: MockBillingService!
    var configService: MockConfigService!
    var coordinator: MockCoordinator<SettingsRoute, SettingsEvent>!
    var delegate: MockSettingsProcessorDelegate!
    var errorReporter: MockErrorReporter!
    var premiumUpgradeHelper: MockPremiumUpgradeHelper!
    var subject: SettingsProcessor!
    var stateService: MockStateService!
    var storefrontService: MockStorefrontService!
    var vaultRepository: MockVaultRepository!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        billingService = MockBillingService()
        billingService.isSelfHostedReturnValue = false
        billingService.shouldShowUpgradedToPremiumActionCardReturnValue = false
        configService = MockConfigService()
        coordinator = MockCoordinator()
        delegate = MockSettingsProcessorDelegate()
        errorReporter = MockErrorReporter()
        premiumUpgradeHelper = MockPremiumUpgradeHelper()
        stateService = MockStateService()
        storefrontService = MockStorefrontService()
        storefrontService.isUSStorefrontReturnValue = true
        vaultRepository = MockVaultRepository()

        setUpSubject()
    }

    override func tearDown() {
        super.tearDown()

        billingService = nil
        configService = nil
        coordinator = nil
        delegate = nil
        errorReporter = nil
        premiumUpgradeHelper = nil
        subject = nil
        stateService = nil
        storefrontService = nil
        vaultRepository = nil
    }

    @MainActor
    func setUpSubject(
        presentationMode: SettingsPresentationMode = .tab,
        environmentService: EnvironmentService = MockEnvironmentService(),
    ) {
        subject = SettingsProcessor(
            coordinator: coordinator.asAnyCoordinator(),
            delegate: delegate,
            services: ServiceContainer.withMocks(
                billingService: billingService,
                configService: configService,
                environmentService: environmentService,
                errorReporter: errorReporter,
                stateService: stateService,
                storefrontService: storefrontService,
                vaultRepository: vaultRepository,
            ),
            state: SettingsState(presentationMode: presentationMode),
        )
        subject.premiumUpgradeHelper = premiumUpgradeHelper
    }

    // MARK: Tests

    /// `init()` does not subscribe to the badge publisher when the presentation mode is `.preLogin`.
    @MainActor
    func test_init_preLogin_doesNotSubscribeToBadgePublisher() async {
        setUpSubject(presentationMode: .preLogin)
        XCTAssertNil(subject.badgeUpdateTask)
    }

    /// `init()` subscribes to the badge publisher and notifies the delegate to update the badge
    /// count when it changes.
    @MainActor
    func test_init_subscribesToBadgePublisher() async throws {
        stateService.activeAccount = .fixture()
        setUpSubject()
        XCTAssertNotNil(subject.badgeUpdateTask)

        var badgeState = SettingsBadgeState.fixture(badgeValue: "1", vaultUnlockSetupProgress: .setUpLater)
        stateService.settingsBadgeSubject.send(badgeState)
        try await waitForAsync { self.delegate.badgeValue == "1" }
        XCTAssertEqual(delegate.badgeValue, "1")
        XCTAssertEqual(subject.state.badgeState, badgeState)

        badgeState = SettingsBadgeState.fixture(
            autofillSetupProgress: .setUpLater,
            badgeValue: "2",
            vaultUnlockSetupProgress: .setUpLater,
        )
        stateService.settingsBadgeSubject.send(badgeState)
        try await waitForAsync { self.delegate.badgeValue == "2" }
        XCTAssertEqual(delegate.badgeValue, "2")
        XCTAssertEqual(subject.state.badgeState, badgeState)

        badgeState = SettingsBadgeState.fixture(badgeValue: nil)
        stateService.settingsBadgeSubject.send(badgeState)
        try await waitForAsync { self.delegate.badgeValue == nil }
        XCTAssertNil(delegate.badgeValue)
        XCTAssertEqual(subject.state.badgeState, badgeState)
    }

    /// `init()` subscribes to the badge publisher and logs an error if one occurs.
    @MainActor
    func test_init_subscribesToBadgePublisher_error() async throws {
        setUpSubject()

        stateService.settingsBadgeSubject.send(SettingsBadgeState.fixture(badgeValue: "1"))
        try await waitForAsync { !self.errorReporter.errors.isEmpty }

        XCTAssertEqual(errorReporter.errors as? [StateServiceError], [.noActiveAccount])
    }

    /// Receiving `.aboutPressed` navigates to the about screen.
    @MainActor
    func test_receive_aboutPressed() {
        subject.receive(.aboutPressed)

        XCTAssertEqual(coordinator.routes.last, .about)
    }

    /// Receiving `.accountSecurityPressed` navigates to the account security screen.
    @MainActor
    func test_receive_accountSecurityPressed() {
        subject.receive(.accountSecurityPressed)

        XCTAssertEqual(coordinator.routes.last, .accountSecurity)
    }

    /// Receiving `.appearancePressed` navigates to the appearance screen.
    @MainActor
    func test_receive_appearancePressed() {
        subject.receive(.appearancePressed)

        XCTAssertEqual(coordinator.routes.last, .appearance)
    }

    /// Receiving `.autoFillPressed` navigates to the auto-fill screen.
    @MainActor
    func test_receive_autoFillPressed() {
        subject.receive(.autoFillPressed)

        XCTAssertEqual(coordinator.routes.last, .autoFill)
    }

    /// Receiving `.dismiss` has the coordinator dismiss the view.
    @MainActor
    func test_receive_dismiss() {
        subject.receive(.dismiss)

        XCTAssertEqual(coordinator.routes.last, .dismiss())
    }

    /// Receiving `.otherPressed` navigates to the other screen.
    @MainActor
    func test_receive_otherPressed() {
        subject.receive(.otherPressed)

        XCTAssertEqual(coordinator.routes.last, .other)
    }

    /// `perform(.planPressed)` opens the web vault subscription page.
    @MainActor
    func test_perform_planPressed_opensWebVault() async {
        let environment = MockEnvironmentService()
        setUpSubject(environmentService: environment)

        await subject.perform(.planPressed)

        XCTAssertEqual(subject.state.url, environment.manageSubscriptionURL)
        XCTAssertTrue(coordinator.routes.isEmpty)
        XCTAssertFalse(premiumUpgradeHelper.startInAppPremiumUpgradeCalled)
    }

    /// Receiving `.vaultPressed` navigates to the vault settings screen.
    @MainActor
    func test_receive_vaultPressed() {
        subject.receive(.vaultPressed)

        XCTAssertEqual(coordinator.routes.last, .vault)
    }

    /// `perform(.appeared)` shows the plan row for a signed-in account.
    @MainActor
    func test_perform_appeared_showsPlanRow() async {
        configService.featureFlagsBool[.premiumUpgradePath] = false
        billingService.isSelfHostedReturnValue = true
        storefrontService.isUSStorefrontReturnValue = false
        vaultRepository.doesActiveAccountHavePremiumResult = false

        await subject.perform(.appeared)

        XCTAssertTrue(subject.state.showPlanRow)
    }

    /// `perform(.appeared)` does nothing in pre-login presentation mode.
    @MainActor
    func test_perform_appeared_preLogin_doesNothing() async {
        setUpSubject(presentationMode: .preLogin)
        await subject.perform(.appeared)
        XCTAssertFalse(subject.state.hasPremium)
        XCTAssertFalse(subject.state.showPlanRow)
    }

    /// `perform(.appeared)` sets `shouldShowUpgradedToPremiumActionCard` to `true` when the
    /// billing service returns `true`.
    @MainActor
    func test_perform_appeared_setsShowUpgradedToPremiumActionCard_true() async {
        billingService.shouldShowUpgradedToPremiumActionCardReturnValue = true

        await subject.perform(.appeared)

        XCTAssertTrue(subject.state.shouldShowUpgradedToPremiumActionCard)
    }

    /// `perform(.appeared)` sets `shouldShowUpgradedToPremiumActionCard` to `false` when the
    /// billing service returns `false`.
    @MainActor
    func test_perform_appeared_setsShowUpgradedToPremiumActionCard_false() async {
        billingService.shouldShowUpgradedToPremiumActionCardReturnValue = false

        await subject.perform(.appeared)

        XCTAssertFalse(subject.state.shouldShowUpgradedToPremiumActionCard)
    }

    /// `perform(.dismissUpgradedToPremiumActionCard)` hides the card and persists the dismissal.
    @MainActor
    func test_perform_dismissUpgradedToPremiumActionCard() async {
        subject.state.shouldShowUpgradedToPremiumActionCard = true

        await subject.perform(.dismissUpgradedToPremiumActionCard)

        XCTAssertFalse(subject.state.shouldShowUpgradedToPremiumActionCard)
        XCTAssertEqual(billingService.setUpgradedToPremiumActionCardDismissedCallsCount, 1)
    }

    /// `receive(.learnMoreAboutPremium)` opens the learn more URL, hides the card, and persists
    /// the dismissal.
    @MainActor
    func test_receive_learnMoreAboutPremium() {
        subject.state.shouldShowUpgradedToPremiumActionCard = true
        subject.receive(.learnMoreAboutPremium)

        XCTAssertEqual(subject.state.url, ExternalLinksConstants.learnMoreAboutPremium)
        XCTAssertFalse(subject.state.shouldShowUpgradedToPremiumActionCard)
        waitFor { billingService.setUpgradedToPremiumActionCardDismissedCallsCount == 1 }
        XCTAssertEqual(billingService.setUpgradedToPremiumActionCardDismissedCallsCount, 1)
    }

    /// `receive(.clearUrl)` clears the URL from state.
    @MainActor
    func test_receive_clearUrl() {
        subject.state.url = .example
        subject.receive(.clearUrl)

        XCTAssertNil(subject.state.url)
    }
}

class MockSettingsProcessorDelegate: SettingsProcessorDelegate {
    var badgeValue: String?

    func updateSettingsTabBadge(_ badgeValue: String?) {
        self.badgeValue = badgeValue
    }
}
