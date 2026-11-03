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
        .navigationBarTitle(Localizations.vowkey, displayMode: .inline)
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

    /// Authored Vowkey brand header with concise product grounding.
    private var brandHeader: some View {
        VStack(spacing: 12) {
            Image(decorative: Asset.Images.logo)
                .renderingMode(.original)
                .resizable()
                .scaledToFit()
                .frame(height: 40)

            Text(Localizations.logInToVowkey)
                .styleGuide(.title2, weight: .bold)
                .multilineTextAlignment(.center)
                .foregroundColor(SharedAsset.Colors.textPrimary.swiftUIColor)

            Text("Documents, logins, keys, and forms — encrypted before sync.")
                .styleGuide(.subheadline)
                .multilineTextAlignment(.center)
                .foregroundColor(SharedAsset.Colors.textSecondary.swiftUIColor)
                .padding(.horizontal, 12)
        }
        .frame(maxWidth: .infinity)
    }

    /// The section of the view containing input fields and action buttons.
    private var landingDetails: some View {
        VStack(alignment: .leading, spacing: 18) {
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

            VStack(spacing: 10) {
                AsyncButton(Localizations.continue) {
                    await store.perform(.continuePressed)
                }
                .accessibilityIdentifier("ContinueButton")
                .disabled(!store.state.isContinueButtonEnabled)
                .buttonStyle(.primary())

                Button("Continue without an account") {
                    store.send(.continueWithoutAccountPressed)
                }
                .accessibilityIdentifier("ContinueWithoutAccountButton")
                .buttonStyle(.secondary())
            }

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
                .padding(.top, 2)
            }

            Button {
                store.send(.showPreLoginSettings)
            } label: {
                Label(Localizations.appSettings, image: SharedAsset.Icons.cog16.swiftUIImage)
            }
            .accessibilityIdentifier("AppSettingsButton")
            .buttonStyle(.vowkeyBorderless)
            .frame(maxWidth: .infinity, alignment: .center)
        }
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
