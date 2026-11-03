import SwiftUI
import VowkeyResources

// MARK: - IntroCarouselState

/// An object that defines the current state of a `IntroCarouselView`.
///
struct IntroCarouselState: Equatable {
    // MARK: Types

    /// A single preview row displayed inside a carousel showcase card.
    ///
    struct PreviewRow: Equatable, Identifiable {
        /// Stable row identifier.
        let id: String

        /// SF Symbol name for the row icon.
        let icon: String

        /// Row label.
        let label: String

        /// Row value or tag.
        let value: String

        /// Whether the value uses monospaced styling.
        var isMonospaced = false

        /// Whether the value highlights as an active Vowkey accent pill.
        var isAccent = false
    }

    /// A model representing the data to display on a single page in the carousel.
    ///
    struct CarouselPage: Equatable, Identifiable {
        /// A unique identifier of the page.
        let id: String = UUID().uuidString

        /// Eyebrow label for the preview card.
        let cardHeader: String

        /// Trailing status pill on the preview card.
        let cardBadge: String

        /// An image to display.
        let image: Image

        /// A message to display on the page.
        let message: String

        /// Preview rows illustrating the Vowkey workflow.
        let rows: [PreviewRow]

        /// SF Symbol name for the card header icon.
        let symbolName: String

        /// A title to display on the page.
        let title: String
    }

    // MARK: Properties

    /// The index of the currently visible page in the carousel.
    var currentPageIndex = 0

    /// The list of scrollable pages displayed in the carousel.
    let pages: [CarouselPage] = [
        CarouselPage(
            cardHeader: Localizations.vowkeyIntroDocCardHeader,
            cardBadge: Localizations.vowkeyIntroDocCardBadge,
            image: Asset.Images.Illustrations.items.swiftUIImage,
            message: Localizations.vowkeyIntroDocMessage,
            rows: [
                PreviewRow(
                    id: "r1",
                    icon: "person.text.rectangle",
                    label: Localizations.vowkeyIntroDocRowName,
                    value: Localizations.vowkeyIntroDocRowFilled,
                    isAccent: true,
                ),
                PreviewRow(
                    id: "r2",
                    icon: "number",
                    label: Localizations.vowkeyIntroDocRowNumber,
                    value: "•••• 4821",
                    isMonospaced: true,
                ),
                PreviewRow(
                    id: "r3",
                    icon: "calendar",
                    label: Localizations.vowkeyIntroDocRowExpiry,
                    value: "2031-08-14",
                    isMonospaced: true,
                ),
            ],
            symbolName: "doc.viewfinder",
            title: Localizations.vowkeyIntroDocTitle,
        ),
        CarouselPage(
            cardHeader: Localizations.vowkeyIntroVaultCardHeader,
            cardBadge: Localizations.vowkeyIntroVaultCardBadge,
            image: Asset.Images.Illustrations.biometricsPhone.swiftUIImage,
            message: Localizations.vowkeyIntroVaultMessage,
            rows: [
                PreviewRow(
                    id: "v1",
                    icon: "globe",
                    label: Localizations.vowkeyIntroVaultRowLogins,
                    value: Localizations.vowkeyIntroVaultRowAutofill,
                ),
                PreviewRow(
                    id: "v2",
                    icon: "key.fill",
                    label: Localizations.vowkeyIntroVaultRowKeys,
                    value: "Bearer · .env",
                    isMonospaced: true,
                ),
                PreviewRow(
                    id: "v3",
                    icon: "person.crop.rectangle.stack",
                    label: Localizations.identities,
                    value: Localizations.vowkeyIntroVaultRowProfilesValue,
                    isAccent: true,
                ),
            ],
            symbolName: "lock.shield",
            title: Localizations.vowkeyIntroVaultTitle,
        ),
        CarouselPage(
            cardHeader: Localizations.vowkeyIntroAgentCardHeader,
            cardBadge: Localizations.vowkeyIntroAgentCardBadge,
            image: Asset.Images.Illustrations.generate.swiftUIImage,
            message: Localizations.vowkeyIntroAgentMessage,
            rows: [
                PreviewRow(id: "a1", icon: "cpu", label: "Claude Code", value: "travel.example", isMonospaced: true),
                PreviewRow(
                    id: "a2",
                    icon: "tag",
                    label: Localizations.vowkeyIntroAgentRowReference,
                    value: "@vk:profile/id",
                    isMonospaced: true,
                ),
                PreviewRow(
                    id: "a3",
                    icon: "checkmark.circle.fill",
                    label: Localizations.vowkeyIntroAgentRowApproval,
                    value: Localizations.vowkeyAgentAllowOnce,
                    isAccent: true,
                ),
            ],
            symbolName: "sparkles.rectangle.stack",
            title: Localizations.vowkeyIntroAgentTitle,
        ),
        CarouselPage(
            cardHeader: Localizations.vowkeyIntroSyncCardHeader,
            cardBadge: Localizations.vowkeyIntroSyncCardBadge,
            image: Asset.Images.Illustrations.secureDevices.swiftUIImage,
            message: Localizations.vowkeyIntroSyncMessage,
            rows: [
                PreviewRow(
                    id: "s1",
                    icon: "iphone",
                    label: Localizations.vowkeyOnThisDevice,
                    value: Localizations.vowkeyIntroSyncRowNoAccount,
                    isAccent: true,
                ),
                PreviewRow(
                    id: "s2",
                    icon: "laptopcomputer.and.iphone",
                    label: Localizations.vowkeyIntroSyncRowCrossDevice,
                    value: Localizations.vowkeyIntroSyncCardBadge,
                ),
                PreviewRow(
                    id: "s3",
                    icon: "faceid",
                    label: Localizations.vowkeyIntroSyncRowBiometric,
                    value: "Face ID",
                ),
            ],
            symbolName: "checkmark.shield",
            title: Localizations.vowkeyIntroSyncTitle,
        ),
    ]
}
