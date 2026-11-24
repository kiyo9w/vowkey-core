import UIKit
import VowkeyKit

// MARK: - TabModule

/// An object that builds coordinators for the tab interface.
///
@MainActor
public protocol TabModule: AnyObject {
    /// Initializes a coordinator for navigating to `TabRoute`s.
    ///
    func makeTabCoordinator( // swiftlint:disable:this function_parameter_count
        errorReporter: ErrorReporter,
        rootNavigator: RootNavigator,
        settingsDelegate: SettingsCoordinatorDelegate,
        tabNavigator: TabNavigator,
        vaultDelegate: VaultCoordinatorDelegate,
        vaultRepository: VaultRepository,
    ) -> AnyCoordinator<TabRoute, Void>
}

// MARK: - AppModule

extension DefaultAppModule: TabModule {
    public func makeTabCoordinator( // swiftlint:disable:this function_parameter_count
        errorReporter: ErrorReporter,
        rootNavigator: RootNavigator,
        settingsDelegate: SettingsCoordinatorDelegate,
        tabNavigator: TabNavigator,
        vaultDelegate: VaultCoordinatorDelegate,
        vaultRepository: VaultRepository,
    ) -> AnyCoordinator<TabRoute, Void> {
        TabCoordinator(
            errorReporter: errorReporter,
            module: self,
            policyService: services.policyService,
            rootNavigator: rootNavigator,
            services: services,
            settingsDelegate: settingsDelegate,
            syncService: services.syncService,
            tabNavigator: tabNavigator,
            vaultDelegate: vaultDelegate,
            vaultRepository: vaultRepository,
        ).asAnyCoordinator()
    }
}
