import UIKit
import VowkeyKit

// MARK: - VowkeyTabBarController

/// A `UITabBarController` subclass conforming to `TabNavigator`. This class manages
/// a set of tabs and handles dynamic appearance changes between light/dark mode.
///
class VowkeyTabBarController: UITabBarController, TabNavigator {
    // MARK: Properties

    /// The tabs used in the UITabBarController, mapping each `TabRoute` to its respective `Navigator`.
    private var tabsAndNavigators: [TabRoute: any Navigator] = [:]

    var rootViewController: UIViewController? {
        self
    }

    // MARK: Lifecycle

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)

        if traitCollection.hasDifferentColorAppearance(comparedTo: previousTraitCollection) {
            setNavigators(tabsAndNavigators)
        }
    }

    // MARK: TabNavigator

    func navigator<Tab: TabRepresentable>(for tab: Tab) -> Navigator? {
        if let tabRoute = tab as? TabRoute {
            return tabsAndNavigators.first(where: { $0.key.index == tabRoute.index })?.value
        }
        return viewControllers?[tab.index] as? Navigator
    }

    func setNavigators<Tab: Hashable & TabRepresentable>(_ tabs: [Tab: Navigator]) {
        tabsAndNavigators = tabs as? [TabRoute: Navigator] ?? [:]

        viewControllers = tabs
            .sorted { $0.key.index < $1.key.index }
            .compactMap { tab in
                guard let viewController = tab.value.rootViewController else { return nil }
                viewController.tabBarItem.title = tab.key.title
                viewController.tabBarItem.image = tab.key.image
                viewController.tabBarItem.selectedImage = tab.key.selectedImage
                return viewController
            }
    }
}
