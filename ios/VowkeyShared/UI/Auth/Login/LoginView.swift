import CryptoKit
import AuthenticationServices
import VowkeyKit
import VowkeyResources
import SwiftUI

// MARK: - LoginView

/// A view that allows the user to input their master password to complete the
/// login flow, or allows the user to navigate to separate views for alternate
/// forms of login.
///
struct LoginView: View {
    // MARK: Properties

    /// The `Store` for this view.
    @ObservedObject var store: Store<LoginState, LoginAction, LoginEffect>

    var body: some View {
        VStack(spacing: 24) {
            textField

            loginButtons

            loggedInAs
        }
        .scrollView()
        .background(SharedAsset.Colors.backgroundPrimary.swiftUIColor.ignoresSafeArea())
        .navigationTitle(Localizations.vowkey)
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(true)
        .toolbar {
            optionsToolbarMenu {
                Button(Localizations.getMasterPasswordwordHint) {
                    store.send(.getMasterPasswordHintPressed)
                }
            }
        }
        .task {
            await store.perform(.appeared)
        }
    }

    /// The text field along with the master password hint button.
    @ViewBuilder var textField: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeyTextField(
                title: Localizations.masterPassword,
                text: store.binding(
                    get: \.masterPassword,
                    send: LoginAction.masterPasswordChanged,
                ),
                accessibilityIdentifier: "LoginMasterPasswordEntry",
                passwordVisibilityAccessibilityId: "PasswordVisibilityToggle",
                isPasswordAutoFocused: true,
                isPasswordVisible: store.binding(
                    get: \.isMasterPasswordRevealed,
                    send: LoginAction.revealMasterPasswordFieldPressed,
                ),
                footerContent: {
                    Button(Localizations.getMasterPasswordwordHint) {
                        store.send(.getMasterPasswordHintPressed)
                    }
                    .buttonStyle(.vowkeyBorderless)
                    .padding(.vertical, 14)
                    .accessibilityIdentifier("GetMasterPasswordHintLabel")
                },
            )
            .textFieldConfiguration(.password)
            .submitLabel(.go)
            .onSubmit {
                Task {
                    await store.perform(.loginWithMasterPasswordPressed)
                }
            }
        }
    }

    /// The set of login option buttons.
    @ViewBuilder var loginButtons: some View {
        VStack(alignment: .center, spacing: 12) {
            AsyncButton(Localizations.logInWithMasterPassword) {
                await store.perform(.loginWithMasterPasswordPressed)
            }
            .accessibilityIdentifier("LogInWithMasterPasswordButton")
            .buttonStyle(.primary())

            if store.state.isLoginWithDeviceVisible {
                Button {
                    store.send(.loginWithDevicePressed)
                } label: {
                    HStack(spacing: 8) {
                        Image(decorative: SharedAsset.Icons.mobile16)
                            .imageStyle(.accessoryIcon16(scaleWithFont: true))
                        Text(Localizations.logInWithDevice)
                    }
                }
                .accessibilityIdentifier("LogInWithAnotherDeviceButton")
                .buttonStyle(.secondary())
            }

            Button {
                store.send(.enterpriseSingleSignOnPressed)
            } label: {
                HStack(spacing: 8) {
                    Image(decorative: SharedAsset.Icons.provider16)
                        .imageStyle(.accessoryIcon16(scaleWithFont: true))
                    Text(Localizations.logInSso)
                }
            }
            .accessibilityIdentifier("LogInWithSsoButton")
            .buttonStyle(.secondary())

            if store.state.isSocialLoginEnabled {
                SocialSignInButtonsView(
                    loadingProvider: store.state.socialLoadingProvider,
                    showOrDivider: false,
                ) { provider in
                    await store.perform(.socialSignInPressed(provider))
                }
            }

            SignInWithAppleButton(.signIn) { request in
                var bytes = [UInt8](repeating: 0, count: 32)
                let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
                guard status == errSecSuccess else {
                    store.send(.signInWithAppleFailed("nonce"))
                    return
                }
                let raw = Data(bytes).base64EncodedString()
                    .replacingOccurrences(of: "+", with: "-")
                    .replacingOccurrences(of: "/", with: "_")
                    .replacingOccurrences(of: "=", with: "")
                let nonce = SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
                store.send(.signInWithAppleRequested(nonce: nonce))
                request.requestedScopes = [.fullName, .email]
                request.nonce = nonce
            } onCompletion: { result in
                switch result {
                case let .success(authorization):
                    guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                          let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) })
                    else {
                        store.send(.signInWithAppleFailed("missing identity token"))
                        return
                    }
                    store.send(.signInWithAppleCompleted(identityToken: token, email: credential.email))
                case let .failure(error):
                    let authorizationError = error as? ASAuthorizationError
                    if authorizationError?.code == .canceled || authorizationError?.code == .unknown { return }
                    store.send(.signInWithAppleFailed(error.localizedDescription))
                }
            }
            .signInWithAppleButtonStyle(.black)
            .frame(maxWidth: .infinity, minHeight: 50, maxHeight: 50)
            .accessibilityIdentifier("SignInWithAppleButton")
        }
    }

    /// The "logged in as..." text along with the not you button.
    @ViewBuilder var loggedInAs: some View {
        VStack(alignment: .center, spacing: 2) {
            Text(Localizations.loggedInAsOn(
                store.state.username,
                store.state.serverURLString,
            ))
            .accessibilityIdentifier("LoggingInAsLabel")
            .foregroundColor(SharedAsset.Colors.textSecondary.swiftUIColor)
            .multilineTextAlignment(.center)

            Button(Localizations.notYou) {
                store.send(.notYouPressed)
            }
            .accessibilityIdentifier("NotYouLabel")
            .foregroundColor(SharedAsset.Colors.textInteraction.swiftUIColor)
        }
        .frame(maxWidth: .infinity, alignment: .center)
        .styleGuide(.footnote)
    }
}

// MARK: - Previews

#if DEBUG
#Preview("Empty") {
    NavigationView {
        LoginView(
            store: Store(
                processor: StateProcessor(
                    state: LoginState(),
                ),
            ),
        )
    }
}

#Preview("With Device") {
    NavigationView {
        LoginView(
            store: Store(
                processor: StateProcessor(
                    state: LoginState(
                        isLoginWithDeviceVisible: true,
                    ),
                ),
            ),
        )
    }
}
#endif
