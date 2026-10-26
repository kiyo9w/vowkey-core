import VowkeyResources
import SwiftUI

// MARK: - VowkeyToggleStyle

/// A tinted toggle style.
///
public struct VowkeyToggleStyle: ToggleStyle {
    /// A value indicating whether the toggle is currently enabled or disabled.
    @Environment(\.isEnabled) var isEnabled

    public func makeBody(configuration: Configuration) -> some View {
        Toggle(configuration)
            .vowkeyToggleLabelStyle(isEnabled: isEnabled)
            .tint(SharedAsset.Colors.iconSecondary.swiftUIColor)
    }
}

// MARK: ToggleStyle

public extension ToggleStyle where Self == VowkeyToggleStyle {
    /// The style for toggles used in this application.
    static var vowkey: VowkeyToggleStyle { VowkeyToggleStyle() }
}

// MARK: - View

extension View {
    /// Applies the label styling used by `VowkeyToggleStyle`, so toggle titles remain visually
    /// consistent whether they're rendered through a `Toggle`'s label or as standalone content.
    ///
    /// - Parameter isEnabled: Whether the toggle is currently enabled.
    /// - Returns: The view styled to match `VowkeyToggleStyle`.
    func vowkeyToggleLabelStyle(isEnabled: Bool) -> some View {
        styleGuide(.body)
            .foregroundColor(
                isEnabled
                    ? SharedAsset.Colors.textPrimary.swiftUIColor
                    : SharedAsset.Colors.buttonFilledDisabledForeground.swiftUIColor,
            )
    }
}
