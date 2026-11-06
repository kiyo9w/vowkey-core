import SwiftUI
import UIKit
import VowkeyKit
import VowkeyResources
import VowkeySdk

// MARK: - VowkeySettingsTabView

struct VowkeySettingsTabView: View {
    // MARK: Properties

    @ObservedObject var model: VowkeyWorkspaceModel

    @SwiftUI.Environment(\.openURL) private var openURL
    @SwiftUI.State private var isShowingLogoutConfirm = false

    private var appVersionText: String {
        let short = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    private var chevron: some View {
        Image(asset: SharedAsset.Icons.chevronRight16)
            .foregroundColor(Color(asset: SharedAsset.Colors.textSecondary))
    }

    // MARK: Body

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                accountSection
                aiAndPrivacySection
                autofillAndSecuritySection
                toolsAndDataSection
                appearanceSection
                aboutSection
            }
            .padding(.horizontal, 12)
            .padding(.top, 12)
            .padding(.bottom, 88)
        }
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .navigationBar(title: Localizations.settings, titleDisplayMode: .inline)
        .confirmationDialog(
            "Sign out of \(model.accountEmail ?? "Vowkey")?",
            isPresented: $isShowingLogoutConfirm,
            titleVisibility: .visible,
        ) {
            Button(Localizations.logOut, role: .destructive) {
                model.logoutCurrentAccount()
            }
            Button(Localizations.cancel, role: .cancel) {}
        }
    }

    // MARK: Sections

    private var accountSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader("Account & sync")
            if model.isSignedIn {
                ContentBlock(dividerLeadingPadding: 48) {
                    HStack(spacing: 12) {
                        VowkeyMonogramTile(
                            name: model.accountEmail ?? "Account",
                            seed: model.accountEmail ?? "account",
                            size: 42,
                        )
                        VStack(alignment: .leading, spacing: 2) {
                            Text(model.accountEmail ?? "Signed in")
                                .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                                .lineLimit(1)
                            Text("Synced · \(model.serverLabel)")
                                .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                        }
                        Spacer()
                    }
                    .padding(16)

                    SettingsListItem(Localizations.syncNow, icon: SharedAsset.Icons.arrowSync24) {
                        Task { await model.syncNow() }
                    } trailingContent: { chevron }

                    SettingsListItem(Localizations.lockNow, icon: SharedAsset.Icons.locked24) {
                        model.lockCurrentSession()
                    } trailingContent: { chevron }

                    Button {
                        isShowingLogoutConfirm = true
                    } label: {
                        HStack(spacing: 12) {
                            SharedAsset.Icons.unlocked24.swiftUIImage
                                .imageStyle(.rowIcon(color: VowkeyMobileTheme.red))
                            Text(Localizations.logOut)
                                .styleGuide(.body, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.red)
                            Spacer()
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 16)
                    }
                    .background(VowkeyMobileTheme.surface)
                }
            } else {
                VowkeyGroupedCard {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 12) {
                            VowkeyKindTile(kind: .profile, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(Localizations.vowkeyOnThisDevice)
                                    .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.ink)
                                Text("Saved locally on this iPhone. Sign in anytime to sync with Mac, Android, or AI agents.")
                                    .styleGuide(.callout, includeLinePadding: false)
                                    .foregroundColor(VowkeyMobileTheme.muted)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }

                        HStack(spacing: 10) {
                            Button("Sign in to sync") {
                                model.onSignInRequested()
                            }
                            .buttonStyle(.primary(size: .medium))
                            .accessibilityIdentifier("SettingsSignInButton")

                            Button(Localizations.createAccount) {
                                model.onCreateAccountRequested()
                            }
                            .buttonStyle(.secondary(shouldFillWidth: false, size: .medium))
                            .accessibilityIdentifier("SettingsCreateAccountButton")
                        }
                    }
                    .padding(16)
                }
            }
        }
    }

    private var aiAndPrivacySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader("AI & privacy")
            ContentBlock(dividerLeadingPadding: 48) {
                VStack(alignment: .leading, spacing: 6) {
                    Toggle(isOn: $model.isOnDeviceOnly) {
                        HStack(spacing: 12) {
                            SharedAsset.Icons.locked24.swiftUIImage
                                .imageStyle(.rowIcon)
                            Text("On-device only")
                                .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                        }
                    }
                    .tint(VowkeyMobileTheme.blue)
                    .accessibilityIdentifier("SettingsOnDeviceOnlyToggle")

                    Text("Run document OCR and form matching locally on this iPhone without sending files to Vowkey's cloud AI.")
                        .styleGuide(.subheadline, includeLinePadding: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.leading, 36)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 14)
                .background(VowkeyMobileTheme.surface)
            }
        }
    }

    private var autofillAndSecuritySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader("Autofill & security")
            ContentBlock(dividerLeadingPadding: 48) {
                SettingsListItem(
                    VowkeyMobileTheme.tr("PasswordAutoFill", "Autofill"),
                    icon: SharedAsset.Icons.checkCircle24,
                ) {
                    if model.isSignedIn {
                        model.onOpenAutofillSetup()
                    } else if let url = URL(string: UIApplication.openSettingsURLString) {
                        openURL(url)
                    }
                } trailingContent: {
                    HStack(spacing: 6) {
                        Text("iOS Settings")
                            .styleGuide(.callout, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.muted)
                        chevron
                    }
                }

                if model.isSignedIn {
                    SettingsListItem(
                        Localizations.accountSecurity,
                        icon: SharedAsset.Icons.locked24,
                    ) {
                        model.onOpenSecuritySettings()
                    } trailingContent: { chevron }
                }
            }
        }
    }

    private var toolsAndDataSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader("Data")
            ContentBlock(dividerLeadingPadding: 48) {
                NavigationLink {
                    VowkeyRecentlyDeletedView(model: model)
                } label: {
                    HStack(spacing: 4) {
                        SharedAsset.Icons.trash24.swiftUIImage
                            .imageStyle(.rowIcon)
                            .padding(.trailing, 8)
                        Text(VowkeyMobileTheme.tr("VowkeyRecentlyDeleted", "Recently deleted"))
                            .styleGuide(.body)
                            .foregroundColor(VowkeyMobileTheme.ink)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.vertical, 16)
                        if !model.trashedCiphers.isEmpty {
                            VowkeyBadge(badgeValue: "\(model.trashedCiphers.count)")
                        }
                        chevron
                    }
                    .padding(.horizontal, 12)
                    .background(VowkeyMobileTheme.surface)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("SettingsRecentlyDeletedRow")

                if model.hasSampleData {
                    Button {
                        Task { await model.clearSampleData() }
                    } label: {
                        HStack(spacing: 12) {
                            SharedAsset.Icons.trash24.swiftUIImage
                                .imageStyle(.rowIcon(color: VowkeyMobileTheme.red))
                            Text("Remove sample data")
                                .styleGuide(.body, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.red)
                            Spacer()
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 16)
                        .background(VowkeyMobileTheme.surface)
                    }
                    .buttonStyle(.plain)
                } else {
                    SettingsListItem(
                        "Load sample documents",
                        icon: SharedAsset.Icons.fileText24,
                    ) {
                        Task { await model.loadAllSamples() }
                    } trailingContent: { chevron }
                }
            }
        }
    }

    private var appearanceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader(Localizations.appearance)
            ContentBlock(dividerLeadingPadding: 48) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 12) {
                        SharedAsset.Icons.paintBrush.swiftUIImage
                            .imageStyle(.rowIcon)
                        Text(Localizations.theme)
                            .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.ink)
                    }

                    Picker(
                        Localizations.theme,
                        selection: Binding(
                            get: { model.appTheme },
                            set: { nextTheme in
                                Task { await model.updateTheme(nextTheme) }
                            },
                        ),
                    ) {
                        Text("System").tag(AppTheme.default)
                        Text("Light").tag(AppTheme.light)
                        Text("Dark").tag(AppTheme.dark)
                    }
                    .pickerStyle(.segmented)
                }
                .padding(14)

                SettingsListItem(
                    Localizations.language,
                    icon: SharedAsset.Icons.globe24,
                ) {
                    model.onOpenLanguagePicker()
                } trailingContent: {
                    HStack(spacing: 6) {
                        Text(model.languageTitle)
                            .styleGuide(.callout, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.muted)
                        chevron
                    }
                }
            }
        }
    }

    private var aboutSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader(Localizations.about)
            ContentBlock(dividerLeadingPadding: 16) {
                Image(decorative: Asset.Images.logo)
                    .renderingMode(.original)
                    .resizable()
                    .scaledToFit()
                    .frame(height: 26)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 14)

                HStack {
                    Text(Localizations.version)
                        .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.ink)
                    Spacer()
                    Text(appVersionText)
                        .styleGuide(.sensitiveInfoSmall, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 15)

                HStack {
                    Text("Sync server")
                        .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.ink)
                    Spacer()
                    Text(model.serverLabel)
                        .styleGuide(.sensitiveInfoSmall, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 15)
            }
        }
    }
}

// MARK: - VowkeyRecentlyDeletedView

struct VowkeyRecentlyDeletedView: View {
    @ObservedObject var model: VowkeyWorkspaceModel

    @SwiftUI.State private var isConfirmingEmpty = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if model.trashedCiphers.isEmpty {
                    VowkeyGroupedCard {
                        VStack(spacing: 10) {
                            VowkeyKindTile(kind: .trash, size: 42)
                            Text("Recently deleted is empty")
                                .styleGuide(.bodySemibold, weight: .semibold, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                            Text("Deleted profiles, logins, keys, and notes stay here until you remove them permanently.")
                                .styleGuide(.callout, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(24)
                    }
                } else {
                    VowkeyGroupedCard {
                        ForEach(Array(model.trashedCiphers.enumerated()), id: \.offset) { index, cipher in
                            let kind = VowkeyWorkspaceModel.itemKind(for: cipher)
                            HStack(spacing: 12) {
                                VowkeyKindTile(kind: kind, size: 36)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(VowkeyMobileTheme.displayName(cipher.name))
                                        .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                        .foregroundColor(VowkeyMobileTheme.ink)
                                        .lineLimit(1)
                                    Text(kind.singularTitle)
                                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                        .foregroundColor(VowkeyMobileTheme.muted)
                                }
                                Spacer()
                                Button("Restore") {
                                    Task { await model.restore(cipher) }
                                }
                                .buttonStyle(.secondary(shouldFillWidth: false, size: .small))
                                .accessibilityIdentifier("RestoreButton_\(cipher.name)")

                                Button(role: .destructive) {
                                    Task { await model.deletePermanently(cipher) }
                                } label: {
                                    SharedAsset.Icons.trash16.swiftUIImage
                                        .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.red))
                                        .frame(width: 28, height: 28)
                                }
                                .buttonStyle(.plain)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)

                            if index < model.trashedCiphers.count - 1 {
                                Divider().padding(.leading, 62)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 88)
        }
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .navigationBar(title: VowkeyMobileTheme.tr("VowkeyRecentlyDeleted", "Recently deleted"), titleDisplayMode: .inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if !model.trashedCiphers.isEmpty {
                    Button("Empty", role: .destructive) {
                        isConfirmingEmpty = true
                    }
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.red)
                }
            }
        }
        .confirmationDialog(
            "Delete all items permanently?",
            isPresented: $isConfirmingEmpty,
            titleVisibility: .visible,
        ) {
            Button("Delete permanently", role: .destructive) {
                Task { await model.emptyRecentlyDeleted() }
            }
            Button(Localizations.cancel, role: .cancel) {}
        }
    }
}
