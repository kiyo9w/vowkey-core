import SwiftUI
import VowkeyKit
import VowkeyResources

// MARK: - IntroCarouselView

/// A view that introduces Vowkey's core workflows and lets the user create an account,
/// log in, or start directly on this device.
///
struct IntroCarouselView: View {
    // MARK: Properties

    /// An environment variable for getting the vertical size class of the view.
    @Environment(\.verticalSizeClass) var verticalSizeClass

    /// The `Store` for this view.
    @ObservedObject var store: Store<IntroCarouselState, IntroCarouselAction, IntroCarouselEffect>

    // MARK: View

    var body: some View {
        VStack(spacing: 0) {
            headerBar

            TabView(selection: store.binding(
                get: \.currentPageIndex,
                send: IntroCarouselAction.currentPageIndexChanged,
            )) {
                ForEachIndexed(store.state.pages) { index, page in
                    pageView(page)
                        .tag(index)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            .animation(.default, value: store.state.currentPageIndex)

            VStack(spacing: 10) {
                AsyncButton(Localizations.createAccount) {
                    await store.perform(.createAccount)
                }
                .buttonStyle(.primary())

                Button(Localizations.logIn) {
                    store.send(.logIn)
                }
                .buttonStyle(.secondary())

                Button(Localizations.vowkeyContinueWithoutAccount) {
                    store.send(.continueWithoutAccount)
                }
                .accessibilityIdentifier("IntroContinueWithoutAccountButton")
                .buttonStyle(.vowkeyBorderless)
                .padding(.top, 2)
            }
            .dynamicTypeSize(...DynamicTypeSize.xxxLarge)
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 14)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(SharedAsset.Colors.backgroundPrimary.swiftUIColor.ignoresSafeArea())
        .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
        .multilineTextAlignment(.center)
    }

    // MARK: Private Views

    /// Calm top brand lockup.
    private var headerBar: some View {
        HStack {
            Image(decorative: Asset.Images.logo)
                .resizable()
                .scaledToFit()
                .frame(height: 30)
            Spacer()
            Text(Localizations.vowkeyHeaderOnDeviceSynced)
                .styleGuide(.caption1, weight: .medium)
                .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(
                    Capsule()
                        .fill(SharedAsset.Colors.backgroundSecondary.swiftUIColor),
                )
                .overlay(
                    Capsule()
                        .strokeBorder(SharedAsset.Colors.strokeDivider.swiftUIColor, lineWidth: 1),
                )
        }
        .padding(.horizontal, 22)
        .padding(.top, 12)
        .padding(.bottom, 4)
    }

    /// A dynamic stack view that lays out content vertically when in a regular vertical size class
    /// and horizontally for the compact vertical size class.
    @ViewBuilder
    private func dynamicStackView(
        minHeight: CGFloat,
        @ViewBuilder cardContent: () -> some View,
        @ViewBuilder textContent: () -> some View,
    ) -> some View {
        Group {
            if verticalSizeClass == .regular {
                VStack(spacing: 28) {
                    Spacer(minLength: 4)
                    cardContent()
                    textContent()
                    Spacer(minLength: 28)
                }
                .padding(.horizontal, 20)
                .frame(maxWidth: .infinity, minHeight: minHeight)
            } else {
                HStack(alignment: .center, spacing: 28) {
                    cardContent()
                        .frame(maxWidth: 320)
                    textContent()
                        .frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity, minHeight: minHeight)
            }
        }
        .scrollView(
            addVerticalPadding: false,
            backgroundColor: SharedAsset.Colors.backgroundPrimary.swiftUIColor,
        )
    }

    /// A view that displays a carousel page with a structured paper-utility preview card.
    @ViewBuilder
    private func pageView(_ page: IntroCarouselState.CarouselPage) -> some View {
        GeometryReader { reader in
            dynamicStackView(minHeight: reader.size.height) {
                showcaseCard(for: page)
                    .accessibilityHidden(true)
            } textContent: {
                VStack(spacing: 12) {
                    Text(page.title)
                        .styleGuide(.title2, weight: .bold)
                        .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)

                    Text(page.message)
                        .styleGuide(.body)
                        .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.horizontal, 4)
            }
        }
    }

    /// Structured Vowkey preview card grounded in Katagami paper-utility tokens.
    @ViewBuilder
    private func showcaseCard(for page: IntroCarouselState.CarouselPage) -> some View {
        let shape = RoundedRectangle(cornerRadius: 16, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(SharedAsset.Colors.tintPrimary.swiftUIColor.opacity(0.12))
                        .frame(width: 32, height: 32)
                    Image(systemName: page.symbolName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                }

                Text(page.cardHeader)
                    .styleGuide(.subheadline, weight: .semibold)
                    .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)

                Spacer()

                Text(page.cardBadge)
                    .styleGuide(.caption2, weight: .semibold)
                    .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 4)
                    .background(
                        Capsule()
                            .fill(SharedAsset.Colors.tintPrimary.swiftUIColor.opacity(0.10)),
                    )
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 13)

            Divider()

            VStack(spacing: 0) {
                ForEach(Array(page.rows.enumerated()), id: \.element.id) { idx, row in
                    showcaseRow(for: row)
                    if idx < page.rows.count - 1 {
                        Divider()
                            .padding(.leading, 47)
                    }
                }
            }
        }
        .background(SharedAsset.Colors.backgroundSecondary.swiftUIColor)
        .clipShape(shape)
        .overlay(
            shape.strokeBorder(SharedAsset.Colors.strokeDivider.swiftUIColor, lineWidth: 1),
        )
        .shadow(color: Color.black.opacity(0.045), radius: 10, x: 0, y: 4)
    }

    private func showcaseRow(for row: IntroCarouselState.PreviewRow) -> some View {
        HStack(spacing: 11) {
            Image(systemName: row.icon)
                .font(.footnote.weight(.medium))
                .foregroundStyle(SharedAsset.Colors.iconPrimary.swiftUIColor)
                .frame(width: 20)

            Text(row.label)
                .styleGuide(.subheadline)
                .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)

            Spacer()

            if row.isAccent {
                Text(row.value)
                    .styleGuide(.caption1, weight: .semibold)
                    .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .fill(SharedAsset.Colors.tintPrimary.swiftUIColor.opacity(0.10)),
                    )
            } else {
                Text(row.value)
                    .font(row.isMonospaced ? .caption.monospaced() : .caption)
                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - Previews

#if DEBUG
#Preview("Carousel") {
    IntroCarouselView(store: Store(processor: StateProcessor(state: IntroCarouselState())))
}

@available(iOS 17, *)
#Preview("Carousel Landscape", traits: .landscapeRight) {
    IntroCarouselView(store: Store(processor: StateProcessor(state: IntroCarouselState())))
}
#endif
