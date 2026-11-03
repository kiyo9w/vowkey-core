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
            cardHeader: "Document read",
            cardBadge: "Ready to fill",
            image: Asset.Images.Illustrations.items.swiftUIImage,
            message: "Read a passport, ID card, tax slip, or contract once and fill web or PDF forms by meaning.",
            rows: [
                PreviewRow(
                    id: "r1",
                    icon: "person.text.rectangle",
                    label: "Full name",
                    value: "Filled",
                    isAccent: true,
                ),
                PreviewRow(
                    id: "r2",
                    icon: "number",
                    label: "Document number",
                    value: "•••• 4821",
                    isMonospaced: true,
                ),
                PreviewRow(
                    id: "r3",
                    icon: "calendar",
                    label: "Date of expiry",
                    value: "2031-08-14",
                    isMonospaced: true,
                ),
            ],
            symbolName: "doc.viewfinder",
            title: "Read documents, fill any form",
        ),
        CarouselPage(
            cardHeader: "Encrypted vault",
            cardBadge: "All items",
            image: Asset.Images.Illustrations.biometricsPhone.swiftUIImage,
            message: "Keep logins, passkeys, API keys, environments, and personal or client profiles in one vault.",
            rows: [
                PreviewRow(id: "v1", icon: "globe", label: "Logins & passkeys", value: "AutoFill"),
                PreviewRow(
                    id: "v2",
                    icon: "key.fill",
                    label: "Keys & environments",
                    value: "Bearer · .env",
                    isMonospaced: true,
                ),
                PreviewRow(
                    id: "v3",
                    icon: "person.crop.rectangle.stack",
                    label: "Profiles",
                    value: "Family & clients",
                    isAccent: true,
                ),
            ],
            symbolName: "lock.shield",
            title: "Every detail you fill with",
        ),
        CarouselPage(
            cardHeader: "Waiting for you",
            cardBadge: "Ask first",
            image: Asset.Images.Illustrations.generate.swiftUIImage,
            message: "AI agents fill forms with @vk: handles so raw secrets stay in your vault until you approve.",
            rows: [
                PreviewRow(id: "a1", icon: "cpu", label: "Claude Code", value: "travel.example", isMonospaced: true),
                PreviewRow(id: "a2", icon: "tag", label: "Handle", value: "@vk:profile/id", isMonospaced: true),
                PreviewRow(
                    id: "a3",
                    icon: "checkmark.circle.fill",
                    label: "Approval",
                    value: "Allow once",
                    isAccent: true,
                ),
            ],
            symbolName: "sparkles.rectangle.stack",
            title: "AI agents fill without seeing secrets",
        ),
        CarouselPage(
            cardHeader: "Your keys",
            cardBadge: "Zero-knowledge",
            image: Asset.Images.Illustrations.secureDevices.swiftUIImage,
            message: "Start right away on this device without an account, or sync encrypted across Mac and iPhone.",
            rows: [
                PreviewRow(
                    id: "s1",
                    icon: "iphone",
                    label: "On this device",
                    value: "No account needed",
                    isAccent: true,
                ),
                PreviewRow(
                    id: "s2",
                    icon: "laptopcomputer.and.iphone",
                    label: "Cross-device sync",
                    value: "End-to-end",
                ),
                PreviewRow(id: "s3", icon: "faceid", label: "Biometric unlock", value: "Face ID"),
            ],
            symbolName: "checkmark.shield",
            title: "Private on this device or synced",
        ),
    ]
}
