import SwiftUI
import UIKit
import VowkeyResources
import VowkeySdk

// MARK: - NativeVaultModel

/// View model managing local and synced vault items, document reading, and form matching.
@MainActor
final class NativeVaultModel: ObservableObject {
    @Published private(set) var items: [CipherView] = []
    @Published private(set) var message: String?
    @Published var kind = "login"
    @Published var name = ""
    @Published var username = ""
    @Published var password = ""
    @Published var secret = ""
    @Published var sendStyle = "bearer"
    @Published var hosts = ""
    @Published var headerName = ""
    @Published var basicUsername = ""
    @Published var memberName = ""
    @Published var memberItemId = ""
    @Published var profileName = ""
    @Published var detailLabel = ""
    @Published var detailValue = ""
    @Published var captureText = ""
    @Published var formLabel = ""
    @Published var formSection = "Applicant"
    @Published var selectedProfileId = ""
    @Published var isUnlocked = false

    private let guest = NativeLocalVault.shared
    private let account: (CipherService, ClientService, StateService, APIService)?
    private let onFill: ((CipherView) -> Void)?
    private var accountUser: String?

    init(
        services: (any HasCipherService & HasClientService & HasStateService & HasAPIService)? = nil,
        fill: ((CipherView) -> Void)? = nil,
    ) {
        account = services.map { ($0.cipherService, $0.clientService, $0.stateService, $0.apiService) }
        onFill = fill
    }

    var keys: [CipherView] { items.filter { $0.type == .apiKey } }
    var profiles: [CipherView] { items.filter(NativeProfile.confirmed) }

    func capture() { Task { await readDocument() } }
    func fill() { Task { await matchForm() } }
    func load() { Task { await reload() } }

    func lock() {
        guest.lock()
        accountUser = nil
        isUnlocked = false
        items = []
    }

    func save() { Task { await store(draft()) } }
    func select(_ item: CipherView) { onFill?(item) }

    private func draft() -> CipherView? {
        do {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            switch kind {
            case "key":
                let key = ApiKeyView(
                    value: secret,
                    sendStyle: sendStyle,
                    allowedHosts: hosts.split { $0.isWhitespace || $0 == "," }.map(String.init),
                    headerName: headerName.nilIfEmpty,
                    basicUsername: basicUsername.nilIfEmpty,
                )
                try NativeCipher.validate(name: trimmed, key: key, environment: nil, keys: [])
                return NativeCipher.replacing(NativeCipher.make(type: .apiKey, name: trimmed), apiKey: key)
            case "environment":
                let environment = EnvironmentView(members: [EnvironmentMember(name: memberName, itemId: memberItemId)])
                try NativeCipher.validate(name: trimmed, key: nil, environment: environment, keys: Set(keys.compactMap(\.id)))
                return NativeCipher.replacing(NativeCipher.make(type: .environment, name: trimmed), environment: environment)
            case "profile":
                return try NativeProfile.typed(name: profileName, rows: [(detailLabel, detailValue)])
            default:
                guard !trimmed.isEmpty, !username.isEmpty, !password.isEmpty else {
                    throw NativeVaultError.invalidInput
                }
                return NativeCipher.replacing(
                    NativeCipher.make(type: .login, name: trimmed),
                    login: VowkeySdk.LoginView(
                        username: username,
                        password: password,
                        passwordRevisionDate: nil,
                        uris: nil,
                        totp: nil,
                        autofillOnPageLoad: nil,
                        fido2Credentials: nil,
                    ),
                )
            }
        } catch {
            message = (error as? LocalizedError)?.errorDescription
            return nil
        }
    }

    private func matched(_ label: String, profile: CipherView) -> String? {
        NativeProfile.details(profile).first {
            ($0["label"] as? String)?.localizedCaseInsensitiveCompare(label) == .orderedSame
                && ($0["agentRule"] as? String) != "never"
        }.flatMap { NativeProfile.value($0) }
    }

    private func matchForm() async {
        let label = formLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else {
            message = NativeVaultError.invalidInput.errorDescription
            return
        }
        do {
            var decisionError: Error?
            do {
                if let value = try await NativeDecision.match(
                    label: label,
                    section: formSection,
                    profiles: profiles,
                    account: account,
                    userId: accountUser,
                    installationId: guest.installationId,
                ) {
                    message = value
                    return
                }
            } catch {
                decisionError = error
            }
            guard let profile = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first else {
                message = "Save a profile before filling."
                return
            }
            guard let value = matched(label, profile: profile) else {
                message = (decisionError as? LocalizedError)?.errorDescription
                    ?? decisionError?.localizedDescription
                    ?? NativeVaultError.unavailable.errorDescription
                return
            }
            try remember(profileId: profile.id, section: formSection, signature: "\(formSection)|\(label)")
            message = value
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func readDocument() async {
        guard !captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            message = NativeVaultError.unreadable.errorDescription
            return
        }
        do {
            let read = try await NativeDecision.read(
                text: captureText,
                account: account,
                userId: accountUser,
                installationId: guest.installationId,
            )
            let attachmentId = UUID().uuidString.lowercased()
            let profile = try NativeProfile.captured(
                read,
                fileName: "capture.txt",
                mediaType: "text/plain",
                attachmentId: attachmentId,
            )
            if let account, let userId = accountUser {
                let context = try await account.1.vault(for: userId).ciphers().encrypt(cipherView: profile)
                let saved = try await account.0.addCipherWithServer(
                    context.cipher,
                    encryptedByKeyId: context.encryptedByKeyId,
                    encryptedFor: userId,
                )
                let vault = try await account.1.vault(for: userId)
                let userKey = try await Data(base64Encoded: account.1.crypto().getUserEncryptionKey()) ?? Data()
                let encrypted = try vault.ciphers().encryptLegacyAttachment(
                    cipher: saved,
                    attachment: AttachmentView(
                        id: attachmentId,
                        url: nil,
                        size: String(captureText.utf8.count),
                        sizeName: nil,
                        fileName: "capture.txt",
                        key: nil,
                    ),
                    contents: Data(captureText.utf8),
                    userKey: userKey,
                )
                _ = try await account.0.saveAttachmentWithServer(cipher: saved, attachment: encrypted)
            } else {
                let saved = try guest.save(
                    profile,
                    attachment: (attachmentId, "capture.txt", Data(captureText.utf8)),
                )
                try remember(profileId: saved.id, section: "document")
            }
            captureText = ""
            await reload()
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func reload() async {
        do {
            if let account,
               let userId = try? await account.2.getActiveAccountId(),
               try await account.2.isAuthenticated(userId: userId) {
                accountUser = userId
                let key = try await account.1.crypto().getUserEncryptionKey()
                guard let userKey = Data(base64Encoded: key) else { throw NativeVaultError.locked }
                let vault = try await account.1.vault(for: userId)
                let allCiphers = try await account.0.fetchAllCiphers().filter { $0.deletedDate == nil }
                items = allCiphers.compactMap { cipher in
                    try? vault.ciphers().decryptLegacyCipher(cipher: cipher, userKey: userKey)
                }
            } else {
                accountUser = nil
                try guest.unlock()
                items = try guest.ciphers().filter { $0.deletedDate == nil }
            }
            isUnlocked = true
            if selectedProfileId.isEmpty { selectedProfileId = profiles.first?.id ?? "" }
            message = nil
        } catch {
            isUnlocked = accountUser != nil || guest.isUnlocked
            message = (error as? LocalizedError)?.errorDescription
        }
    }

    private func remember(profileId: String?, section: String, signature: String? = nil) throws {
        guard let profileId else { return }
        let id = UUID().uuidString.lowercased()
        try guest.saveSideRecord("form-binding", id: id, value: [
            "v": 1,
            "id": id,
            "formSignature": signature ?? section,
            "sectionId": section,
            "profileCipherId": profileId,
            "updatedAt": AgentManagementDate.string(Date()),
        ])
    }

    private func store(_ view: CipherView?) async {
        guard let view else { return }
        do {
            if let account, let userId = accountUser {
                let context = try await account.1.vault(for: userId).ciphers().encrypt(cipherView: view)
                _ = try await account.0.addCipherWithServer(
                    context.cipher,
                    encryptedByKeyId: context.encryptedByKeyId,
                    encryptedFor: userId,
                )
            } else {
                _ = try guest.save(view)
            }
            name = ""
            username = ""
            password = ""
            secret = ""
            hosts = ""
            headerName = ""
            basicUsername = ""
            memberName = ""
            memberItemId = ""
            profileName = ""
            detailLabel = ""
            detailValue = ""
            await reload()
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}

// MARK: - NativeVaultView

/// Local and synced Vowkey vault screen for logins, keys, environments, document reading, and form filling.
struct NativeVaultView: View {
    @StateObject var model: NativeVaultModel

    var body: some View {
        List {
            if let message = model.message {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: "sparkles")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                        Text(message)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                            .textSelection(.enabled)
                        Spacer()
                        Button {
                            UIPasteboard.general.string = message
                        } label: {
                            Image(systemName: "doc.on.doc")
                                .font(.footnote)
                                .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                        }
                        .buttonStyle(.borderless)
                        .accessibilityLabel("Copy")
                    }
                    .padding(.vertical, 2)
                }
            }

            if model.isUnlocked {
                savedItemsSection
                addSection
                readDocumentSection
                fillFormSection

                Section {
                    Button(role: .destructive) {
                        model.lock()
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: "lock")
                            Text("Lock")
                        }
                        .foregroundStyle(SharedAsset.Colors.error.swiftUIColor)
                    }
                    .accessibilityIdentifier("NativeVaultLockButton")
                }
            } else {
                Section {
                    VStack(alignment: .leading, spacing: 12) {
                        HStack(spacing: 10) {
                            Image(systemName: "lock.fill")
                                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                            Text("Vault locked")
                                .font(.headline)
                                .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                        }
                        Text("Unlock to view saved details, read documents, or fill forms on this device.")
                            .font(.subheadline)
                            .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                        Button {
                            model.load()
                        } label: {
                            Label("Unlock", systemImage: "lock.open.fill")
                                .font(.subheadline.weight(.semibold))
                        }
                        .accessibilityIdentifier("NativeVaultUnlockButton")
                    }
                    .padding(.vertical, 6)
                }
            }
        }
        .listStyle(.insetGrouped)
        .modifier(PaperListBackgroundModifier())
        .navigationTitle("On this device")
        .task { model.load() }
    }

    // MARK: Sections

    private var savedItemsSection: some View {
        Section("Saved on this device") {
            if model.items.isEmpty {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .fill(SharedAsset.Colors.backgroundTertiary.swiftUIColor)
                            .frame(width: 36, height: 36)
                        Image(systemName: "tray")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(SharedAsset.Colors.iconPrimary.swiftUIColor)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Nothing saved yet")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                        Text("Add a login, key, or profile below, or read a document.")
                            .font(.caption)
                            .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    }
                }
                .padding(.vertical, 4)
            } else {
                ForEach(model.items, id: \.id) { item in
                    Button {
                        model.select(item)
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .fill(SharedAsset.Colors.tintPrimary.swiftUIColor.opacity(0.11))
                                    .frame(width: 36, height: 36)
                                Image(systemName: iconName(for: item))
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                            }
                            VStack(alignment: .leading, spacing: 3) {
                                Text(item.name)
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                                Text(subtitle(for: item))
                                    .font(.caption)
                                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                            }
                            Spacer()
                            Text(kindLabel(for: item))
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                                .padding(.horizontal, 8)
                                .padding(.vertical, 3)
                                .background(
                                    Capsule()
                                        .fill(SharedAsset.Colors.backgroundTertiary.swiftUIColor),
                                )
                        }
                        .padding(.vertical, 2)
                    }
                }
            }
        }
    }

    private var addSection: some View {
        Section("Add") {
            Picker("Type", selection: $model.kind) {
                Text("Login").tag("login")
                Text("Key").tag("key")
                Text("Environment").tag("environment")
                Text("Profile").tag("profile")
            }
            .pickerStyle(.segmented)
            .padding(.vertical, 2)

            if model.kind == "key" {
                TextField("Name", text: $model.name)
                SecureField("Key", text: $model.secret)
                Picker("Send as", selection: $model.sendStyle) {
                    Text("Bearer").tag("bearer")
                    Text("Header").tag("header")
                    Text("Basic").tag("basic")
                }
                TextField("Allowed hosts", text: $model.hosts)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if model.sendStyle == "header" {
                    TextField("Header name", text: $model.headerName)
                        .textInputAutocapitalization(.never)
                }
                if model.sendStyle == "basic" {
                    TextField("Username", text: $model.basicUsername)
                        .textInputAutocapitalization(.never)
                }
            } else if model.kind == "environment" {
                TextField("Name", text: $model.name)
                TextField("Variable", text: $model.memberName)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Picker("Key", selection: $model.memberItemId) {
                    Text("Choose a key").tag("")
                    ForEach(model.keys, id: \.id) {
                        Text($0.name).tag($0.id ?? "")
                    }
                }
            } else if model.kind == "profile" {
                TextField("Name", text: $model.profileName)
                TextField("Detail", text: $model.detailLabel)
                TextField("Value", text: $model.detailValue)
            } else {
                TextField("Name", text: $model.name)
                TextField("Username", text: $model.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $model.password)
            }

            Button {
                model.save()
            } label: {
                HStack {
                    Image(systemName: "plus.circle.fill")
                    Text("Save")
                        .fontWeight(.semibold)
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultSaveButton")
        }
    }

    private var readDocumentSection: some View {
        Section {
            ZStack(alignment: .topLeading) {
                if model.captureText.isEmpty {
                    Text("Paste or scan text from a passport, ID card, tax slip, or contract…")
                        .font(.subheadline)
                        .foregroundStyle(SharedAsset.Colors.textDisabled.swiftUIColor)
                        .padding(.top, 8)
                        .padding(.leading, 4)
                        .allowsHitTesting(false)
                }
                TextEditor(text: $model.captureText)
                    .font(.subheadline)
                    .frame(minHeight: 88)
                    .accessibilityIdentifier("NativeVaultCaptureInput")
            }

            Button {
                model.capture()
            } label: {
                HStack {
                    Image(systemName: "doc.viewfinder")
                    Text("Save profile")
                        .fontWeight(.semibold)
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultSaveProfileButton")
        } header: {
            Text("Read a document")
        }
    }

    private var fillFormSection: some View {
        Section("Fill this form") {
            HStack {
                Text("Section")
                    .font(.subheadline)
                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    .frame(width: 84, alignment: .leading)
                TextField("Applicant", text: $model.formSection)
                    .font(.subheadline)
            }

            HStack {
                Text("Field")
                    .font(.subheadline)
                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    .frame(width: 84, alignment: .leading)
                TextField("Field label", text: $model.formLabel)
                    .font(.subheadline)
                    .accessibilityIdentifier("NativeVaultFieldLabelInput")
            }

            if model.profiles.count > 1 {
                Picker("Whose details", selection: $model.selectedProfileId) {
                    ForEach(model.profiles, id: \.id) {
                        Text($0.name).tag($0.id ?? "")
                    }
                }
            }

            Button {
                model.fill()
            } label: {
                HStack {
                    Image(systemName: "arrow.right.doc.on.clipboard")
                    Text("Fill")
                        .fontWeight(.semibold)
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultFillButton")
        }
    }

    // MARK: Helpers

    private func iconName(for item: CipherView) -> String {
        switch item.type {
        case .apiKey:
            "key.fill"
        case .environment:
            "shippingbox.fill"
        case .identity:
            "person.text.rectangle.fill"
        default:
            "globe"
        }
    }

    private func kindLabel(for item: CipherView) -> String {
        switch item.type {
        case .apiKey:
            "Key"
        case .environment:
            "Environment"
        case .identity:
            "Profile"
        default:
            "Login"
        }
    }

    private func subtitle(for item: CipherView) -> String {
        if item.type == .login, let user = item.login?.username, !user.isEmpty {
            return user
        }
        if item.type == .identity {
            let count = NativeProfile.details(item).count
            return count == 1 ? "1 detail" : "\(count) details"
        }
        if item.type == .apiKey, let hosts = item.apiKey?.allowedHosts, !hosts.isEmpty {
            return hosts.joined(separator: ", ")
        }
        if item.type == .environment, let members = item.environment?.members, !members.isEmpty {
            return members.map(\.name).joined(separator: ", ")
        }
        return kindLabel(for: item)
    }
}

/// Applies the warm Vowkey paper-utility background to SwiftUI `List` / `Form` containers.
struct PaperListBackgroundModifier: ViewModifier {
    func body(content: Content) -> some View {
        if #available(iOS 16.0, *) {
            content
                .scrollContentBackground(.hidden)
                .background(SharedAsset.Colors.backgroundPrimary.swiftUIColor.ignoresSafeArea())
        } else {
            content
                .background(SharedAsset.Colors.backgroundPrimary.swiftUIColor.ignoresSafeArea())
        }
    }
}
