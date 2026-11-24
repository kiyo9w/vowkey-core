import PhotosUI
import SwiftUI
import UIKit
import VowkeyKit
import VowkeyResources

// MARK: - VowkeyItemKind

enum VowkeyItemKind: String, CaseIterable, Identifiable {
    case all
    case profile
    case document
    case login
    case card
    case key
    case note
    case environment
    case agent
    case expiring
    case trash

    var id: String { rawValue }

    var iconAsset: SharedImageAsset {
        switch self {
        case .agent:
            SharedAsset.Icons.desktop24
        case .all:
            SharedAsset.Icons.collections24
        case .card:
            SharedAsset.Icons.card24
        case .document:
            SharedAsset.Icons.fileText24
        case .environment:
            SharedAsset.Icons.folder24
        case .expiring:
            SharedAsset.Icons.clock24
        case .key:
            SharedAsset.Icons.key24
        case .login:
            SharedAsset.Icons.globe24
        case .note:
            SharedAsset.Icons.stickyNote24
        case .profile:
            SharedAsset.Icons.idCard24
        case .trash:
            SharedAsset.Icons.trash24
        }
    }

    var filterTitle: String {
        switch self {
        case .agent:
            VowkeyMobileTheme.tr("VowkeyAiAgents", "AI agents")
        case .all:
            VowkeyMobileTheme.tr("All", "All")
        case .card:
            VowkeyMobileTheme.tr("Cards", "Cards")
        case .document:
            VowkeyMobileTheme.tr("VowkeyDocuments", "Documents")
        case .environment:
            VowkeyMobileTheme.tr("VowkeyEnvironments", "Environments")
        case .expiring:
            VowkeyMobileTheme.tr("VowkeyExpiring", "Expiring")
        case .key:
            VowkeyMobileTheme.tr("VowkeyKeys", "Keys")
        case .login:
            VowkeyMobileTheme.tr("Logins", "Logins")
        case .note:
            VowkeyMobileTheme.tr("Notes", "Notes")
        case .profile:
            VowkeyMobileTheme.tr("VowkeyProfiles", "Profiles")
        case .trash:
            VowkeyMobileTheme.tr("VowkeyRecentlyDeleted", "Recently deleted")
        }
    }

    var singularTitle: String {
        switch self {
        case .agent:
            VowkeyMobileTheme.tr("VowkeyAiAgent", "AI agent")
        case .all:
            VowkeyMobileTheme.tr("Item", "Item")
        case .card:
            VowkeyMobileTheme.tr("TypeCard", "Card")
        case .document:
            VowkeyMobileTheme.tr("VowkeyDocument", "Document")
        case .environment:
            VowkeyMobileTheme.tr("VowkeyTypeEnvironment", "Environment")
        case .expiring:
            VowkeyMobileTheme.tr("VowkeyExpiring", "Expiring")
        case .key:
            VowkeyMobileTheme.tr("VowkeyTypeKey", "API key")
        case .login:
            VowkeyMobileTheme.tr("TypeLogin", "Login")
        case .note:
            VowkeyMobileTheme.tr("TypeSecureNote", "Note")
        case .profile:
            VowkeyMobileTheme.tr("VowkeyProfile", "Profile")
        case .trash:
            VowkeyMobileTheme.tr("VowkeyRecentlyDeleted", "Recently deleted")
        }
    }
}

// MARK: - VowkeyMobileTheme

/// Direct bridge to the canonical Vowkey design tokens in `VowkeyResources` and `VowkeyKit`
/// (`SharedAsset.Colors`, `StyleGuideFont` DM Sans + Menlo, `ContentBlock` card geometry,
/// and `SharedAsset.Icons`).
enum VowkeyMobileTheme {
    static var canvas: Color { SharedAsset.Colors.backgroundPrimary.swiftUIColor }
    static var canvasUIColor: UIColor { SharedAsset.Colors.backgroundPrimary.color }
    static var surface: Color { SharedAsset.Colors.backgroundSecondary.swiftUIColor }
    static var surfaceUIColor: UIColor { SharedAsset.Colors.backgroundSecondary.color }
    static var surfaceDisabled: Color { SharedAsset.Colors.backgroundSecondaryDisabled.swiftUIColor }
    static var elevated: Color { SharedAsset.Colors.backgroundTertiary.swiftUIColor }
    static var line: Color { SharedAsset.Colors.strokeDivider.swiftUIColor }
    static var border: Color { SharedAsset.Colors.buttonOutlinedBorder.swiftUIColor }
    static var ink: Color { SharedAsset.Colors.textPrimary.swiftUIColor }
    static var muted: Color { SharedAsset.Colors.textSecondary.swiftUIColor }
    static var iconPrimary: Color { SharedAsset.Colors.iconPrimary.swiftUIColor }
    static var iconSecondary: Color { SharedAsset.Colors.iconSecondary.swiftUIColor }
    static var blue: Color { SharedAsset.Colors.textInteraction.swiftUIColor }
    static var blueUIColor: UIColor { SharedAsset.Colors.tintPrimary.color }
    static var blueInk: Color { SharedAsset.Colors.badgeInfoText.swiftUIColor }
    static var blueSoft: Color { SharedAsset.Colors.badgeInfoBackground.swiftUIColor }
    static var blueSoftBorder: Color { SharedAsset.Colors.badgeInfoBorder.swiftUIColor }
    static var chipFill: Color { SharedAsset.Colors.backgroundTertiary.swiftUIColor }
    static var green: Color { SharedAsset.Colors.statusStrong.swiftUIColor }
    static var greenSoft: Color { SharedAsset.Colors.badgeSuccessBackground.swiftUIColor }
    static var greenBorder: Color { SharedAsset.Colors.badgeSuccessBorder.swiftUIColor }
    static var greenText: Color { SharedAsset.Colors.badgeSuccessText.swiftUIColor }
    static var amber: Color { SharedAsset.Colors.badgeWarningText.swiftUIColor }
    static var amberSoft: Color { SharedAsset.Colors.badgeWarningBackground.swiftUIColor }
    static var amberBorder: Color { SharedAsset.Colors.badgeWarningBorder.swiftUIColor }
    static var red: Color { SharedAsset.Colors.error.swiftUIColor }
    static var redSoft: Color { SharedAsset.Colors.badgeDangerBackground.swiftUIColor }
    static var redBorder: Color { SharedAsset.Colors.badgeDangerBorder.swiftUIColor }
    static var violet: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.77, green: 0.68, blue: 0.99, alpha: 1) : UIColor(red: 0.43, green: 0.28, blue: 0.85, alpha: 1) }) }
    static var violetSoft: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.25, green: 0.19, blue: 0.40, alpha: 0.55) : UIColor(red: 0.95, green: 0.93, blue: 1.0, alpha: 1) }) }
    static var violetBorder: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.45, green: 0.35, blue: 0.70, alpha: 0.65) : UIColor(red: 0.85, green: 0.80, blue: 0.98, alpha: 1) }) }
    static var teal: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.45, green: 0.86, blue: 0.82, alpha: 1) : UIColor(red: 0.06, green: 0.46, blue: 0.43, alpha: 1) }) }
    static var tealSoft: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.10, green: 0.29, blue: 0.28, alpha: 0.55) : UIColor(red: 0.91, green: 0.97, blue: 0.96, alpha: 1) }) }
    static var tealBorder: Color { Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(red: 0.20, green: 0.52, blue: 0.50, alpha: 0.65) : UIColor(red: 0.75, green: 0.90, blue: 0.88, alpha: 1) }) }
    static var kindDocumentBlue: Color { SharedAsset.Colors.iconSecondary.swiftUIColor }

    static let copiedText = tr("Copied", "Copied")

    static func tr(_ key: String, _ fallback: String) -> String {
        let resolved = Resources.localizationFunction(key: key, table: "Localizable", fallbackValue: fallback)
        if resolved.isEmpty || resolved == key {
            return fallback
        }
        return resolved
    }

    static func displayName(_ rawName: String) -> String {
        let cleaned = rawName
            .replacingOccurrences(of: " (Sample)", with: "", options: .caseInsensitive)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? rawName : cleaned
    }

    static func initials(for rawName: String) -> String {
        let stripped = rawName
            .replacingOccurrences(of: #"\([^)]*\)|\[[^\]]*\]"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let source = stripped.isEmpty ? rawName : stripped
        let parts = source
            .split(whereSeparator: \.isWhitespace)
            .compactMap { word -> String? in
                guard let ch = word.first(where: { $0.isLetter || $0.isNumber }) else { return nil }
                return String(ch)
            }
        if parts.count >= 2, let first = parts.first, let last = parts.last {
            return (first + last).uppercased()
        }
        return (parts.first ?? "?").uppercased()
    }

    static func normalizedPhotoJPEGData(
        _ image: UIImage,
        maxDimension: CGFloat = 2400,
        quality: CGFloat = 0.92,
    ) -> Data? {
        let rawW = max(1, image.size.width)
        let rawH = max(1, image.size.height)
        let scale = min(1.0, maxDimension / max(rawW, rawH))
        let rendered: UIImage
        if scale < 0.999 || image.imageOrientation != .up {
            let targetSize = CGSize(
                width: max(1, (rawW * scale).rounded()),
                height: max(1, (rawH * scale).rounded()),
            )
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            rendered = UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: targetSize))
            }
        } else {
            rendered = image
        }
        return rendered.jpegData(compressionQuality: quality) ?? rendered.pngData()
    }
}

// MARK: - VowkeySectionHeader

struct VowkeySectionHeader: View {
    let title: String

    init(_ title: String) {
        self.title = title
    }

    var body: some View {
        Text(title)
            .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
            .foregroundColor(VowkeyMobileTheme.muted)
            .padding(.horizontal, 4)
    }
}

// MARK: - VowkeySampleTag

struct VowkeySampleTag: View {
    var text = "Sample"

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Text(text)
            .styleGuide(.caption2, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
            .foregroundColor(VowkeyMobileTheme.amber)
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(VowkeyMobileTheme.amberSoft)
            .clipShape(shape)
            .overlay(
                shape.strokeBorder(VowkeyMobileTheme.amberBorder, lineWidth: 1),
            )
    }
}

// MARK: - VowkeyKindTile

struct VowkeyKindTile: View {
    let kind: VowkeyItemKind
    var size: CGFloat = 38
    var cornerRadius: CGFloat = 10

    private var iconTint: Color {
        switch kind {
        case .profile, .expiring:
            VowkeyMobileTheme.amber
        case .document:
            VowkeyMobileTheme.blueInk
        case .login:
            VowkeyMobileTheme.greenText
        case .card, .agent:
            VowkeyMobileTheme.violet
        case .key, .environment:
            VowkeyMobileTheme.teal
        case .trash:
            VowkeyMobileTheme.red
        default:
            VowkeyMobileTheme.iconPrimary
        }
    }

    private var tileFill: Color {
        switch kind {
        case .profile, .expiring:
            VowkeyMobileTheme.amberSoft
        case .document:
            VowkeyMobileTheme.blueSoft
        case .login:
            VowkeyMobileTheme.greenSoft
        case .card, .agent:
            VowkeyMobileTheme.violetSoft
        case .key, .environment:
            VowkeyMobileTheme.tealSoft
        case .trash:
            VowkeyMobileTheme.redSoft
        default:
            VowkeyMobileTheme.elevated
        }
    }

    private var tileBorder: Color {
        switch kind {
        case .profile, .expiring:
            VowkeyMobileTheme.amberBorder
        case .document:
            VowkeyMobileTheme.blueSoftBorder
        case .login:
            VowkeyMobileTheme.greenBorder
        case .card, .agent:
            VowkeyMobileTheme.violetBorder
        case .key, .environment:
            VowkeyMobileTheme.tealBorder
        case .trash:
            VowkeyMobileTheme.redBorder
        default:
            VowkeyMobileTheme.line
        }
    }

    var body: some View {
        let iconDimension: CGFloat = size >= 44 ? 22 : 18
        ZStack {
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .fill(tileFill)
                .frame(width: size, height: size)
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(tileBorder, lineWidth: 1)
                .frame(width: size, height: size)
            kind.iconAsset.swiftUIImage
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: iconDimension, height: iconDimension)
                .foregroundColor(iconTint)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - VowkeyMonogramTile

/// Person tile following `lean-down.md` ("amber a person", 10pt rounded square, never a monogram circle).
struct VowkeyMonogramTile: View {
    let name: String
    var seed: String = ""
    var size: CGFloat = 38
    var highlighted = false

    var body: some View {
        let cornerRadius: CGFloat = size <= 30 ? 8 : 10
        let iconDimension: CGFloat = size >= 44 ? 22 : (size <= 30 ? 15 : 18)
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        ZStack {
            shape
                .fill(VowkeyMobileTheme.amberSoft)
                .frame(width: size, height: size)
            shape
                .strokeBorder(VowkeyMobileTheme.amberBorder, lineWidth: 1)
                .frame(width: size, height: size)
            SharedAsset.Icons.idCard24.swiftUIImage
                .resizable()
                .renderingMode(.template)
                .scaledToFit()
                .frame(width: iconDimension, height: iconDimension)
                .foregroundColor(VowkeyMobileTheme.amber)
        }
        .accessibilityHidden(true)
    }
}

// MARK: - VowkeyGroupedCard

/// Matches `ContentBlock` in `VowkeyKit`: `backgroundSecondary`, `12pt` continuous corner radius,
/// `strokeDivider` 1pt border, and soft `0.025` elevation shadow.
struct VowkeyGroupedCard<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(SharedAsset.Colors.backgroundSecondary.swiftUIColor)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(SharedAsset.Colors.strokeDivider.swiftUIColor, lineWidth: 1),
        )
        .shadow(color: Color.black.opacity(0.025), radius: 3, x: 0, y: 1)
    }
}

// MARK: - VowkeyMenuPrimaryPill & VowkeyMenuSecondaryPill

struct VowkeyPrimaryActionLabel: View {
    let title: String
    var icon: SharedImageAsset?

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        HStack(spacing: 8) {
            if let icon {
                icon.swiftUIImage
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: 18, height: 18)
            }
            Text(title)
                .styleGuide(.bodyBold, weight: .bold, includeLinePadding: false, includeLineSpacing: false)
        }
        .foregroundColor(SharedAsset.Colors.buttonFilledForeground.swiftUIColor)
        .padding(.vertical, 12)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity, minHeight: 44)
        .background(SharedAsset.Colors.buttonFilledBackground.swiftUIColor)
        .overlay(shape.strokeBorder(Color.white.opacity(0.16), lineWidth: 1))
        .clipShape(shape)
        .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1)
    }
}

struct VowkeySecondaryActionLabel: View {
    let title: String
    var icon: SharedImageAsset?
    var fillWidth = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        HStack(spacing: 8) {
            if let icon {
                icon.swiftUIImage
                    .resizable()
                    .renderingMode(.template)
                    .scaledToFit()
                    .frame(width: 18, height: 18)
                    .foregroundColor(SharedAsset.Colors.iconPrimary.swiftUIColor)
            }
            Text(title)
                .styleGuide(.calloutSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                .foregroundColor(SharedAsset.Colors.buttonOutlinedForeground.swiftUIColor)
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .frame(maxWidth: fillWidth ? .infinity : nil, minHeight: 44)
        .background(shape.fill(SharedAsset.Colors.backgroundSecondary.swiftUIColor))
        .overlay(shape.strokeBorder(SharedAsset.Colors.buttonOutlinedBorder.swiftUIColor, lineWidth: 1))
        .clipShape(shape)
        .shadow(color: Color.black.opacity(0.025), radius: 2, x: 0, y: 1)
    }
}

// MARK: - VowkeyPhotoLibraryPicker

struct VowkeyPhotoLibraryPicker: UIViewControllerRepresentable {
    let onPickedData: (Data) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPickedData: onPickedData)
    }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = 1
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_: PHPickerViewController, context _: Context) {}

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        let onPickedData: (Data) -> Void

        init(onPickedData: @escaping (Data) -> Void) {
            self.onPickedData = onPickedData
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            picker.dismiss(animated: true)
            guard let provider = results.first?.itemProvider,
                  provider.canLoadObject(ofClass: UIImage.self) else {
                return
            }
            provider.loadObject(ofClass: UIImage.self) { object, _ in
                guard let image = object as? UIImage else {
                    return
                }
                DispatchQueue.global(qos: .userInitiated).async {
                    guard let data = VowkeyMobileTheme.normalizedPhotoJPEGData(image) else { return }
                    Task { @MainActor in
                        self.onPickedData(data)
                    }
                }
            }
        }
    }
}

// MARK: - VowkeyShareSheet

struct VowkeyShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context _: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_: UIActivityViewController, context _: Context) {}
}

// MARK: - VowkeyWorkspaceToolbarModifier

private struct VowkeyWorkspaceToolbarModifier<Trailing: View>: ViewModifier {
    let showFillForm: Bool
    let fillAccessibilityId: String
    let onFillForm: () -> Void
    @ViewBuilder let trailing: Trailing

    func body(content: Content) -> some View {
        if #available(iOS 16.0, *) {
            content.toolbar {
                if showFillForm {
                    ToolbarItem(placement: .navigationBarLeading) {
                        fillButton
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    trailing
                }
            }
        } else {
            content.toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if showFillForm {
                        fillButton
                    }
                }
                ToolbarItem(placement: .navigationBarTrailing) {
                    trailing
                }
            }
        }
    }

    private var fillButton: some View {
        Button(action: onFillForm) {
            Text(VowkeyMobileTheme.tr("VowkeyFillForm", "Fill form"))
                .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                .foregroundColor(VowkeyMobileTheme.blue)
        }
        .accessibilityIdentifier(fillAccessibilityId)
    }
}

extension View {
    func vowkeyWorkspaceToolbar(
        showFillForm: Bool,
        fillAccessibilityId: String,
        onFillForm: @escaping () -> Void,
        @ViewBuilder trailing: () -> some View,
    ) -> some View {
        modifier(
            VowkeyWorkspaceToolbarModifier(
                showFillForm: showFillForm,
                fillAccessibilityId: fillAccessibilityId,
                onFillForm: onFillForm,
                trailing: trailing,
            ),
        )
    }
}
