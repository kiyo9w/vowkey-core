import VowkeyResources
import SwiftUI

// MARK: - VowkeyMenuFooterTextModifier

/// A modifier for the footer on `VowkeyMenu`.
///
public struct VowkeyMenuFooterTextModifier: ViewModifier {
    /// The top padding of the modifier.
    var topPadding: CGFloat

    /// The bottom padding of the modifier.
    var bottomPadding: CGFloat

    // MARK: View

    public func body(content: Content) -> some View {
        content
            .styleGuide(.footnote, includeLinePadding: false, includeLineSpacing: false)
            .foregroundColor(SharedAsset.Colors.textSecondary.swiftUIColor)
            .multilineTextAlignment(.leading)
            .padding(.top, topPadding)
            .padding(.bottom, bottomPadding)
    }
}

public extension View {
    /// A modifier for `VowkeyMenu` footers.
    ///
    /// - Parameters:
    ///   - topPadding: The top padding of the modifier.
    ///   - bottomPadding: The bottom padding of the modifier.
    func vowkeyMenuFooterText(
        topPadding: CGFloat = 0,
        bottomPadding: CGFloat = 12,
    ) -> some View {
        modifier(
            VowkeyMenuFooterTextModifier(
                topPadding: topPadding,
                bottomPadding: bottomPadding,
            ),
        )
    }
}
