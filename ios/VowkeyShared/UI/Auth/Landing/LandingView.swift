import SwiftUI
import VowkeyKit
import VowkeyResources

// MARK: - LandingView

/// A view that allows the user to input their email address to begin the login flow,
/// navigate to account creation, or continue directly on this device.
///
struct LandingView: View {
    // MARK: Properties

    /// The `Store` for this view.
    @ObservedObject var store: Store<LandingState, LandingAction, LandingEffect>

    var body: some View {
        ZStack {
            mainContent
            profileSwitcher
        }
        .background(SharedAsset.Colors.backgroundPrimary.swiftUIColor.ignoresSafeArea())
        .navigationBarTitle("", displayMode: .inline)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if !store.state.profileSwitcherState.accounts.isEmpty {
                    profileSwitcherToolbarItem
                }
            }
        }
        .task {
            await store.perform(.appeared)
        }
        .toast(store.binding(
            get: \.toast,
            send: LandingAction.toastShown,
        ))
    }

    // MARK: Private Views

    /// The Toolbar item for the profile switcher view.
    private var profileSwitcherToolbarItem: some View {
        ProfileSwitcherToolbarView(
            store: store.child(
                state: { state in
                    state.profileSwitcherState
                },
                mapAction: { action in
                    .profileSwitcher(action)
                },
                mapEffect: { effect in
                    .profileSwitcher(effect)
                },
            ),
        )
    }

    /// A view that displays the ability to add or switch between account profiles.
    private var profileSwitcher: some View {
        ProfileSwitcherView(
            store: store.child(
                state: { mainState in
                    mainState.profileSwitcherState
                },
                mapAction: { action in
                    .profileSwitcher(action)
                },
                mapEffect: { profileEffect in
                    .profileSwitcher(profileEffect)
                },
            ),
        )
    }

    /// The main content of the view.
    private var mainContent: some View {
        GeometryReader { geometry in
            VStack(spacing: 0) {
                Spacer(minLength: 18)

                brandHeader
                    .padding(.bottom, 22)

                landingDetails

                Spacer(minLength: 16)
            }
            .padding(.bottom, 16)
            .frame(minHeight: geometry.size.height)
            .scrollView(
                addVerticalPadding: false,
                backgroundColor: SharedAsset.Colors.backgroundPrimary.swiftUIColor,
                showsIndicators: false,
            )
        }
    }

    /// Authored Vowkey brand header.
    private var brandHeader: some View {
        VStack(spacing: 12) {
            Image(decorative: Asset.Images.logo)
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(height: 36)

            Text(Localizations.logInToVowkey)
                .styleGuide(.title2, weight: .bold)
                .multilineTextAlignment(.center)
                .foregroundColor(SharedAsset.Colors.textPrimary.swiftUIColor)
        }
        .frame(maxWidth: .infinity)
    }

    /// The section of the view containing input fields and action buttons.
    private var landingDetails: some View {
        VStack(alignment: .leading, spacing: 18) {
            if store.state.isSocialLoginEnabled {
                SocialSignInButtonsView(
                    loadingProvider: store.state.socialLoadingProvider,
                    showOrDivider: true,
                ) { provider in
                    await store.perform(.socialSignInPressed(provider))
                }
            }

            VStack(spacing: 10) {
                VowkeyTextField(
                    title: Localizations.emailAddress,
                    text: store.binding(
                        get: \.email,
                        send: LandingAction.emailChanged,
                    ),
                    accessibilityIdentifier: "LoginEmailAddressEntry",
                    footerContent: {
                        RegionSelector(
                            selectorLabel: Localizations.loggingInOn,
                            regionName: store.state.region.baseURLDescription,
                        ) {
                            await store.perform(.regionPressed)
                        }
                        .padding(.vertical, 14)
                    },
                )
                .textFieldConfiguration(.email)
                .onSubmit {
                    guard store.state.isContinueButtonEnabled else { return }
                    Task { await store.perform(.continuePressed) }
                }

                VowkeyToggle(Localizations.rememberMe, isOn: store.binding(
                    get: { $0.isRememberMeOn },
                    send: { .rememberMeChanged($0) },
                ))
                .accessibilityIdentifier("RememberMeSwitch")
                .contentBlock()
            }

            AsyncButton(Localizations.continue) {
                await store.perform(.continuePressed)
            }
            .accessibilityIdentifier("ContinueButton")
            .disabled(!store.state.isContinueButtonEnabled)
            .buttonStyle(.primary())

            VStack(spacing: 10) {
                if !store.state.isCreateAccountButtonHidden {
                    HStack(spacing: 4) {
                        Spacer()
                        Text(Localizations.newAroundHere)
                            .foregroundColor(SharedAsset.Colors.textSecondary.swiftUIColor)
                        Button(Localizations.createAccount) {
                            store.send(.createAccountPressed)
                        }
                        .accessibilityIdentifier("CreateAccountButton")
                        .foregroundColor(SharedAsset.Colors.textInteraction.swiftUIColor)
                        Spacer()
                    }
                    .styleGuide(.footnote)
                }

                Button {
                    store.send(.continueWithoutAccountPressed)
                } label: {
                    Text(Localizations.vowkeyContinueWithoutAccount)
                        .styleGuide(.footnote, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(SharedAsset.Colors.textSecondary.swiftUIColor)
                }
                .accessibilityIdentifier("ContinueWithoutAccountButton")
                .frame(maxWidth: .infinity, alignment: .center)

                Button {
                    store.send(.showPreLoginSettings)
                } label: {
                    Label(Localizations.appSettings, image: SharedAsset.Icons.cog16.swiftUIImage)
                }
                .accessibilityIdentifier("AppSettingsButton")
                .buttonStyle(.vowkeyBorderless)
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 2)
            }
            .padding(.top, 2)
        }
    }
}

// MARK: - SocialSignInButtonsView

/// Neutral outlined OAuth sign-in buttons calibrated to Vowkey's warm paper & ink palette.
struct SocialSignInButtonsView: View {
    let loadingProvider: String?
    var showOrDivider = true
    let onSelectProvider: (String) async -> Void

    var body: some View {
        VStack(spacing: 10) {
            socialButton(
                provider: "google",
                title: Localizations.continueWithGoogle,
                accessibilityId: "ContinueWithGoogleButton",
            ) {
                GoogleMarkView()
                    .frame(width: 18, height: 18)
            }

            socialButton(
                provider: "github",
                title: Localizations.continueWithGitHub,
                accessibilityId: "ContinueWithGitHubButton",
            ) {
                GitHubMarkView()
                    .frame(width: 18, height: 18)
            }

            if showOrDivider {
                HStack(spacing: 12) {
                    Rectangle()
                        .fill(SharedAsset.Colors.strokeDivider.swiftUIColor)
                        .frame(height: 1)

                    Text(Localizations.vowkeyOrDivider)
                        .styleGuide(.footnote)
                        .foregroundColor(SharedAsset.Colors.textSecondary.swiftUIColor)

                    Rectangle()
                        .fill(SharedAsset.Colors.strokeDivider.swiftUIColor)
                        .frame(height: 1)
                }
                .padding(.top, 4)
                .accessibilityHidden(true)
            }
        }
    }

    @ViewBuilder
    private func socialButton<Icon: View>(
        provider: String,
        title: String,
        accessibilityId: String,
        @ViewBuilder icon: () -> Icon,
    ) -> some View {
        let isLoading = loadingProvider == provider
        let isDisabled = loadingProvider != nil
        Button {
            Task {
                await onSelectProvider(provider)
            }
        } label: {
            HStack(spacing: 10) {
                if isLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .scaleEffect(0.85)
                        .frame(width: 18, height: 18)
                } else {
                    icon()
                }

                Text(title)
                    .styleGuide(.callout, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(SharedAsset.Colors.textPrimary.swiftUIColor)
            }
            .frame(maxWidth: .infinity, minHeight: 48)
            .accessibilityElement(children: .combine)
        }
        .buttonStyle(SocialOutlinedButtonStyle())
        .disabled(isDisabled)
        .accessibilityIdentifier(accessibilityId)
    }
}

private struct SocialOutlinedButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled: Bool

    func makeBody(configuration: Configuration) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        configuration.label
            .padding(.horizontal, 16)
            .background(shape.fill(SharedAsset.Colors.backgroundSecondary.swiftUIColor))
            .overlay(
                shape.strokeBorder(
                    SharedAsset.Colors.buttonOutlinedBorder.swiftUIColor,
                    lineWidth: 1,
                ),
            )
            .contentShape(shape)
            .clipShape(shape)
            .shadow(color: Color.black.opacity(0.025), radius: 2, x: 0, y: 1)
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .opacity(!isEnabled ? 0.6 : (configuration.isPressed ? 0.88 : 1))
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

// MARK: - GoogleMarkView

/// Vector 4-color Google "G" mark drawn directly in SwiftUI from official 24x24 cubic Bezier coordinates.
struct GoogleMarkView: View {
    var body: some View {
        Canvas { context, size in
            let sx = size.width / 24.0
            let sy = size.height / 24.0
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: x * sx, y: y * sy)
            }

            var blue = Path()
            blue.move(to: pt(22.56, 12.25))
            blue.addCurve(to: pt(22.36, 10.0), control1: pt(22.56, 11.47), control2: pt(22.49, 10.72))
            blue.addLine(to: pt(12.0, 10.0))
            blue.addLine(to: pt(12.0, 14.26))
            blue.addLine(to: pt(17.92, 14.26))
            blue.addCurve(to: pt(15.71, 17.57), control1: pt(17.66, 15.63), control2: pt(16.88, 16.79))
            blue.addLine(to: pt(15.71, 20.34))
            blue.addLine(to: pt(19.28, 20.34))
            blue.addCurve(to: pt(22.56, 12.25), control1: pt(21.36, 18.42), control2: pt(22.56, 15.60))
            blue.closeSubpath()
            context.fill(blue, with: .color(Color(red: 0x42 / 255.0, green: 0x85 / 255.0, blue: 0xF4 / 255.0)))

            var green = Path()
            green.move(to: pt(12.0, 23.0))
            green.addCurve(to: pt(19.28, 20.34), control1: pt(14.97, 23.0), control2: pt(17.46, 22.02))
            green.addLine(to: pt(15.71, 17.57))
            green.addCurve(to: pt(12.0, 18.63), control1: pt(14.73, 18.23), control2: pt(13.48, 18.63))
            green.addCurve(to: pt(5.84, 14.10), control1: pt(9.14, 18.63), control2: pt(6.71, 16.70))
            green.addLine(to: pt(2.18, 14.10))
            green.addLine(to: pt(2.18, 16.94))
            green.addCurve(to: pt(12.0, 23.0), control1: pt(3.99, 20.53), control2: pt(7.70, 23.0))
            green.closeSubpath()
            context.fill(green, with: .color(Color(red: 0x34 / 255.0, green: 0xA8 / 255.0, blue: 0x53 / 255.0)))

            var yellow = Path()
            yellow.move(to: pt(5.84, 14.09))
            yellow.addCurve(to: pt(5.49, 12.0), control1: pt(5.62, 13.43), control2: pt(5.49, 12.73))
            yellow.addCurve(to: pt(5.84, 9.91), control1: pt(5.49, 11.27), control2: pt(5.62, 10.57))
            yellow.addLine(to: pt(5.84, 7.07))
            yellow.addLine(to: pt(2.18, 7.07))
            yellow.addCurve(to: pt(1.0, 12.0), control1: pt(1.43, 8.55), control2: pt(1.0, 10.22))
            yellow.addCurve(to: pt(2.18, 16.93), control1: pt(1.0, 13.78), control2: pt(1.43, 15.45))
            yellow.addLine(to: pt(5.84, 14.09))
            yellow.closeSubpath()
            context.fill(yellow, with: .color(Color(red: 0xFB / 255.0, green: 0xBC / 255.0, blue: 0x05 / 255.0)))

            var red = Path()
            red.move(to: pt(12.0, 5.38))
            red.addCurve(to: pt(16.21, 7.02), control1: pt(13.62, 5.38), control2: pt(15.06, 5.94))
            red.addLine(to: pt(19.36, 3.87))
            red.addCurve(to: pt(12.0, 1.0), control1: pt(17.45, 2.09), control2: pt(14.97, 1.0))
            red.addCurve(to: pt(2.18, 7.07), control1: pt(7.70, 1.0), control2: pt(3.99, 3.47))
            red.addLine(to: pt(5.84, 9.91))
            red.addCurve(to: pt(12.0, 5.38), control1: pt(6.71, 7.31), control2: pt(9.14, 5.38))
            red.closeSubpath()
            context.fill(red, with: .color(Color(red: 0xEA / 255.0, green: 0x43 / 255.0, blue: 0x35 / 255.0)))
        }
        .accessibilityHidden(true)
    }
}

// MARK: - GitHubMarkView

/// Vector GitHub Invertocat mark drawn directly in SwiftUI, adapting cleanly to light and dark mode.
struct GitHubMarkView: View {
    var body: some View {
        Canvas { context, size in
            let sx = size.width / 24.0
            let sy = size.height / 24.0
            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: x * sx, y: y * sy)
            }

            var mark = Path()
            mark.move(to: pt(12.0, 0.5))
            mark.addCurve(to: pt(0.5, 12.0), control1: pt(5.65, 0.5), control2: pt(0.5, 5.65))
            mark.addCurve(to: pt(8.36, 22.92), control1: pt(0.5, 17.09), control2: pt(3.79, 21.40))
            mark.addCurve(to: pt(9.15, 22.36), control1: pt(8.94, 23.03), control2: pt(9.15, 22.67))
            mark.addCurve(to: pt(9.13, 20.20), control1: pt(9.15, 22.09), control2: pt(9.14, 21.17))
            mark.addCurve(to: pt(5.26, 18.85), control1: pt(5.93, 20.90), control2: pt(5.26, 18.85))
            mark.addCurve(to: pt(3.98, 17.17), control1: pt(4.74, 17.52), control2: pt(3.98, 17.17))
            mark.addCurve(to: pt(4.06, 16.47), control1: pt(2.94, 16.46), control2: pt(4.06, 16.47))
            mark.addCurve(to: pt(5.82, 17.65), control1: pt(5.21, 16.55), control2: pt(5.82, 17.65))
            mark.addCurve(to: pt(9.16, 18.60), control1: pt(6.84, 19.41), control2: pt(8.50, 18.90))
            mark.addCurve(to: pt(9.89, 17.07), control1: pt(9.26, 17.86), control2: pt(9.56, 17.35))
            mark.addCurve(to: pt(4.65, 11.39), control1: pt(7.34, 16.78), control2: pt(4.65, 15.79))
            mark.addCurve(to: pt(5.84, 8.30), control1: pt(4.65, 10.13), control2: pt(5.10, 9.11))
            mark.addCurve(to: pt(5.95, 5.26), control1: pt(5.72, 8.01), control2: pt(5.32, 6.84))
            mark.addCurve(to: pt(9.12, 6.44), control1: pt(5.95, 5.26), control2: pt(6.92, 4.95))
            mark.addCurve(to: pt(12.0, 6.05), control1: pt(10.04, 6.18), control2: pt(11.02, 6.05))
            mark.addCurve(to: pt(14.88, 6.44), control1: pt(12.98, 6.05), control2: pt(13.96, 6.18))
            mark.addCurve(to: pt(18.05, 5.26), control1: pt(17.08, 4.95), control2: pt(18.05, 5.26))
            mark.addCurve(to: pt(18.16, 8.30), control1: pt(18.68, 6.84), control2: pt(18.28, 8.01))
            mark.addCurve(to: pt(19.35, 11.39), control1: pt(18.90, 9.11), control2: pt(19.35, 10.13))
            mark.addCurve(to: pt(14.09, 17.06), control1: pt(19.35, 15.80), control2: pt(16.65, 16.77))
            mark.addCurve(to: pt(14.87, 19.20), control1: pt(14.50, 17.42), control2: pt(14.87, 18.12))
            mark.addCurve(to: pt(14.86, 22.36), control1: pt(14.87, 20.75), control2: pt(14.86, 21.99))
            mark.addCurve(to: pt(15.65, 22.92), control1: pt(14.86, 22.67), control2: pt(15.07, 23.04))
            mark.addCurve(to: pt(23.5, 12.0), control1: pt(20.21, 21.39), control2: pt(23.5, 17.08))
            mark.addCurve(to: pt(12.0, 0.5), control1: pt(23.5, 5.65), control2: pt(18.35, 0.5))
            mark.closeSubpath()
            context.fill(mark, with: .color(SharedAsset.Colors.textPrimary.swiftUIColor))
        }
        .accessibilityHidden(true)
    }
}

// MARK: - Previews

#if DEBUG
#Preview("Empty Email") {
    NavigationView {
        LandingView(
            store: Store(
                processor: StateProcessor(
                    state: LandingState(
                        email: "",
                        isRememberMeOn: false,
                    ),
                ),
            ),
        )
    }
}

#Preview("Example Email") {
    NavigationView {
        LandingView(
            store: Store(
                processor: StateProcessor(
                    state: LandingState(
                        email: "email@example.com",
                        isRememberMeOn: true,
                    ),
                ),
            ),
        )
    }
}

#Preview("Profiles Closed") {
    NavigationView {
        LandingView(
            store: Store(
                processor: StateProcessor(
                    state: LandingState(
                        email: "",
                        isRememberMeOn: false,
                        profileSwitcherState: ProfileSwitcherState.singleAccountHidden,
                    ),
                ),
            ),
        )
    }
}

#Preview("Profiles Open") {
    NavigationView {
        LandingView(
            store: Store(
                processor: StateProcessor(
                    state: LandingState(
                        email: "",
                        isRememberMeOn: false,
                        profileSwitcherState: ProfileSwitcherState.singleAccount,
                    ),
                ),
            ),
        )
    }
}
#endif
