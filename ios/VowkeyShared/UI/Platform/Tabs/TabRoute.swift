import UIKit
import VowkeyKit
import VowkeyResources

// MARK: - TabRoute

/// The enumeration of tabs displayed by the application.
///
public enum TabRoute: Equatable, Hashable {
    /// The vault tab.
    case vault(VaultRoute)

    /// The documents tab.
    case documents

    /// The AI agents tab.
    case agents

    /// The settings tab.
    case settings(SettingsRoute)

    /// Legacy send route retained for deep-link compatibility.
    case send

    /// Legacy generator route retained for deep-link compatibility.
    case generator(GeneratorRoute)
}

// MARK: - TabRepresentable

extension TabRoute: TabRepresentable {
    public var image: UIImage? {
        switch self {
        case .agents:
            UIImage(systemName: "checkmark.shield")
        case .documents:
            SharedAsset.Icons.fileText24.image
        case .generator:
            SharedAsset.Icons.TabBar.generatorIdle.image
        case .send:
            SharedAsset.Icons.TabBar.sendIdle.image
        case .settings:
            SharedAsset.Icons.TabBar.settingsIdle.image
        case .vault:
            SharedAsset.Icons.TabBar.vaultIdle.image
        }
    }

    public var index: Int {
        switch self {
        case .vault:
            0
        case .documents:
            1
        case .agents:
            2
        case .settings:
            3
        case .send:
            4
        case .generator:
            5
        }
    }

    public var selectedImage: UIImage? {
        switch self {
        case .agents:
            UIImage(systemName: "checkmark.shield.fill")
        case .documents:
            SharedAsset.Icons.fileText24.image
        case .generator:
            SharedAsset.Icons.TabBar.generatorActive.image
        case .send:
            SharedAsset.Icons.TabBar.sendActive.image
        case .settings:
            SharedAsset.Icons.TabBar.settingsActive.image
        case .vault:
            SharedAsset.Icons.TabBar.vaultActive.image
        }
    }

    public var title: String {
        switch self {
        case .agents:
            Localizations.vowkeyAiAgents
        case .documents:
            VowkeyMobileTheme.tr("VowkeyDocuments", "Documents")
        case .generator:
            Localizations.generator
        case .send:
            Localizations.send
        case .settings:
            Localizations.settings
        case .vault:
            VowkeyMobileTheme.tr("Vault", "Vault")
        }
    }
}
