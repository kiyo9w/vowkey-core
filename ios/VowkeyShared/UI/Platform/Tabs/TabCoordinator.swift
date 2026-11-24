import SwiftUI
import UIKit
import VowkeyKit
import VowkeyResources

// MARK: - TabCoordinator

/// A coordinator that manages navigation in Vowkey's 4-tab mobile workspace
/// (Vault, Documents, AI agents, Settings).
///
final class TabCoordinator: Coordinator, HasTabNavigator {
    // MARK: Types

    typealias Module = GeneratorModule
        & NavigatorBuilderModule
        & SendModule
        & SettingsModule
        & VaultModule

    typealias WorkspaceServices = VowkeyWorkspaceModel.WorkspaceServices

    // MARK: Properties

    weak var rootNavigator: (any RootNavigator)?
    private(set) weak var tabNavigator: TabNavigator?

    private weak var agentsNavigator: StackNavigator?
    private var currentTabs: [Int: Navigator] = [:]
    private weak var documentsNavigator: StackNavigator?
    private var errorReporter: ErrorReporter
    private let module: Module
    private let policyService: PolicyService
    private let services: WorkspaceServices?
    private var settingsCoordinator: AnyCoordinator<SettingsRoute, SettingsEvent>?
    private weak var settingsDelegate: SettingsCoordinatorDelegate?
    private weak var settingsNavigator: StackNavigator?
    private let syncService: SyncService
    private var vaultCoordinator: AnyCoordinator<VaultRoute, AuthAction>?
    private weak var vaultDelegate: VaultCoordinatorDelegate?
    private weak var vaultNavigator: StackNavigator?
    private var vaultRepository: VaultRepository
    private var workspaceModel: VowkeyWorkspaceModel?

    // MARK: Initialization

    init(
        errorReporter: ErrorReporter,
        module: Module,
        policyService: PolicyService,
        rootNavigator: RootNavigator,
        services: WorkspaceServices? = nil,
        settingsDelegate: SettingsCoordinatorDelegate,
        syncService: SyncService,
        tabNavigator: TabNavigator,
        vaultDelegate: VaultCoordinatorDelegate,
        vaultRepository: VaultRepository,
    ) {
        self.errorReporter = errorReporter
        self.module = module
        self.policyService = policyService
        self.rootNavigator = rootNavigator
        self.services = services
        self.settingsDelegate = settingsDelegate
        self.syncService = syncService
        self.tabNavigator = tabNavigator
        self.vaultDelegate = vaultDelegate
        self.vaultRepository = vaultRepository
    }

    // MARK: Methods

    func navigate(to route: TabRoute, context: AnyObject?) {
        switch route {
        case .vault:
            tabNavigator?.selectedIndex = visualIndex(for: .vault(.list))
        case .documents:
            tabNavigator?.selectedIndex = visualIndex(for: .documents)
        case .agents:
            tabNavigator?.selectedIndex = visualIndex(for: .agents)
        case let .settings(settingsRoute):
            if settingsRoute == .agents {
                tabNavigator?.selectedIndex = visualIndex(for: .agents)
                return
            }
            tabNavigator?.selectedIndex = visualIndex(for: .settings(.settings(.tab)))
            if case .settings = settingsRoute {
                return
            }
            settingsCoordinator?.navigate(to: settingsRoute, context: context)
        case .generator, .send:
            tabNavigator?.selectedIndex = visualIndex(for: .settings(.settings(.tab)))
        }
    }

    func showErrorAlert(error: any Error, tryAgain _: (() async -> Void)?, onDismissed _: (() -> Void)?) async {
        errorReporter.log(error: error)
    }

    func start() {
        guard let rootNavigator, let tabNavigator, let settingsDelegate, let vaultDelegate else { return }

        rootNavigator.show(child: tabNavigator)

        guard let services else {
            startLegacyFallback(settingsDelegate: settingsDelegate, vaultDelegate: vaultDelegate)
            return
        }

        let vaultNav = makeStyledNavController()
        let documentsNav = makeStyledNavController()
        let agentsNav = makeStyledNavController()
        let settingsNav = makeStyledNavController()

        let settingsCoord = module.makeSettingsCoordinator(
            delegate: settingsDelegate,
            stackNavigator: settingsNav,
        )
        settingsCoordinator = settingsCoord

        let model = VowkeyWorkspaceModel(
            services: services,
            onSignInRequested: { [weak vaultDelegate] in
                vaultDelegate?.didTapAddAccount()
            },
            onCreateAccountRequested: { [weak vaultDelegate] in
                vaultDelegate?.didTapAddAccount()
            },
            onOpenAutofillSetup: { [weak settingsCoord] in
                settingsCoord?.navigate(to: .autoFill)
            },
            onOpenSecuritySettings: { [weak settingsCoord] in
                settingsCoord?.navigate(to: .accountSecurity)
            },
            onOpenLanguagePicker: { [weak self, weak settingsCoord] in
                guard let currentLanguage = self?.services?.stateService.appLanguage else { return }
                settingsCoord?.navigate(to: .selectLanguage(currentLanguage: currentLanguage), context: self)
            },
            onLockRequested: { [weak settingsDelegate] userId in
                settingsDelegate?.lockVault(userId: userId, isManuallyLocking: true)
            },
            onLogoutRequested: { [weak settingsDelegate] userId in
                settingsDelegate?.logout(userId: userId, userInitiated: true)
            },
        )
        workspaceModel = model

        vaultNav.setViewControllers([UIHostingController(rootView: VowkeyVaultTabView(model: model))], animated: false)
        documentsNav.setViewControllers([UIHostingController(rootView: VowkeyDocumentsTabView(model: model))], animated: false)
        let agentsView = AgentManagementView(
            model: AgentManagementModel(services: services),
            onSignInRequested: { [weak vaultDelegate] in
                vaultDelegate?.didTapAddAccount()
            },
        )
        agentsNav.setViewControllers([UIHostingController(rootView: agentsView)], animated: false)
        settingsNav.setViewControllers([UIHostingController(rootView: VowkeySettingsTabView(model: model))], animated: false)

        vaultNavigator = vaultNav
        documentsNavigator = documentsNav
        agentsNavigator = agentsNav
        settingsNavigator = settingsNav

        let tabs: [TabRoute: Navigator] = [
            .vault(.list): vaultNav,
            .documents: documentsNav,
            .agents: agentsNav,
            .settings(.settings(.tab)): settingsNav,
        ]
        currentTabs = Dictionary(uniqueKeysWithValues: tabs.map { ($0.key.index, $0.value) })
        tabNavigator.setNavigators(tabs)

        model.startObservingIfNeeded()
        Task { @MainActor [weak model] in
            guard let model else { return }
            await model.reload()
            #if DEBUG
            await model.runSimulatorAutoFlowIfRequested()
            #endif
        }
    }

    // MARK: Private Methods

    private func makeStyledNavController() -> UINavigationController {
        let nav = module.makeNavigationController()
        nav.navigationBar.prefersLargeTitles = false
        nav.navigationBar.accessibilityIdentifier = "MainHeaderBar"
        let appearance = UINavigationBarAppearance()
        appearance.configureWithOpaqueBackground()
        appearance.backgroundColor = VowkeyMobileTheme.canvasUIColor
        appearance.shadowColor = .clear
        nav.navigationBar.standardAppearance = appearance
        nav.navigationBar.scrollEdgeAppearance = appearance
        nav.navigationBar.tintColor = VowkeyMobileTheme.blueUIColor
        return nav
    }

    private func startLegacyFallback(
        settingsDelegate: SettingsCoordinatorDelegate,
        vaultDelegate: VaultCoordinatorDelegate,
    ) {
        let vaultNav = module.makeNavigationController()
        vaultCoordinator = module.makeVaultCoordinator(delegate: vaultDelegate, stackNavigator: vaultNav)
        vaultCoordinator?.start()
        let settingsNav = module.makeNavigationController()
        let settingsCoord = module.makeSettingsCoordinator(delegate: settingsDelegate, stackNavigator: settingsNav)
        settingsCoord.start()
        settingsCoordinator = settingsCoord
        let tabs: [TabRoute: Navigator] = [
            .vault(.list): vaultNav,
            .settings(.settings(.tab)): settingsNav,
        ]
        currentTabs = Dictionary(uniqueKeysWithValues: tabs.map { ($0.key.index, $0.value) })
        tabNavigator?.setNavigators(tabs)
    }

    private func visualIndex(for route: TabRoute) -> Int {
        let sorted = currentTabs.keys.sorted()
        return sorted.firstIndex(of: route.index) ?? 0
    }
}

// MARK: - SelectLanguageDelegate

extension TabCoordinator: SelectLanguageDelegate {
    func languageSelected(_: LanguageOption) {
        Task { @MainActor [weak self] in
            await self?.workspaceModel?.reload()
        }
    }
}
