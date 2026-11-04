import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VowkeyResources
import VowkeySdk

// MARK: - NativeVaultModel

/// View model managing local and synced vault items, document reading, and form matching.
@MainActor
final class NativeVaultModel: ObservableObject {
    @Published private(set) var items: [CipherView] = []
    /// The last outcome to show above the vault. Anything but a matched value is a problem to fix.
    @Published private(set) var message: String? {
        didSet { messageIsError = true }
    }
    @Published private(set) var messageIsError = false
    @Published private(set) var filledPdfURL: URL?
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
    @Published var formSection = Localizations.vowkeyApplicantPlaceholder
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
    func captureFile(data: Data, fileName: String, mediaType: String) {
        Task { await readDocumentFile(data: data, fileName: fileName, mediaType: mediaType) }
    }
    func fill() { Task { await matchForm() } }
    func fillPdfFile(data: Data, fileName: String) {
        Task { await fillPdfForm(data: data, fileName: fileName) }
    }
    func load() { Task { await reload() } }

    func lock() {
        guest.lock()
        accountUser = nil
        isUnlocked = false
        items = []
        filledPdfURL = nil
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
        if let rustMatch = NativeDecision.fillSingleFieldLocally(label: label, section: formSection, profile: profile) {
            return rustMatch
        }
        return NativeProfile.details(profile).first {
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
                    selectedProfileId: selectedProfileId,
                    account: account,
                    userId: accountUser,
                    installationId: guest.installationId,
                ) {
                    message = value
                    messageIsError = false
                    return
                }
            } catch {
                decisionError = error
            }
            guard let profile = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first else {
                message = Localizations.vowkeySaveProfileBeforeFilling
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
            messageIsError = false
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
            try await persistCapturedProfile(
                read,
                fileName: "capture.txt",
                mediaType: "text/plain",
                rawData: Data(captureText.utf8),
            )
            captureText = ""
            await reload()
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func readDocumentFile(data: Data, fileName: String, mediaType: String) async {
        do {
            let read = try await NativeDecision.readFile(
                data: data,
                fileName: fileName,
                mediaType: mediaType,
                account: account,
                userId: accountUser,
                installationId: guest.installationId,
            )
            try await persistCapturedProfile(
                read,
                fileName: fileName,
                mediaType: mediaType,
                rawData: data,
            )
            await reload()
        } catch {
            message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
    }

    private func persistCapturedProfile(
        _ read: [String: Any],
        fileName: String,
        mediaType: String,
        rawData: Data,
    ) async throws {
        let attachmentId = UUID().uuidString.lowercased()
        let existing = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first
        let profile = try NativeProfile.captured(
            read,
            fileName: fileName,
            mediaType: mediaType,
            attachmentId: attachmentId,
            into: existing,
        )
        if let account, let userId = accountUser {
            let vault = try await account.1.vault(for: userId)
            let context = try await vault.ciphers().encrypt(cipherView: profile)
            let saved: Cipher
            if let existingId = existing?.id {
                try await account.0.updateCipherWithServer(
                    context.cipher,
                    encryptedByKeyId: context.encryptedByKeyId,
                    encryptedFor: userId,
                )
                saved = try await account.0.fetchCipher(withId: existingId) ?? context.cipher
            } else {
                saved = try await account.0.addCipherWithServer(
                    context.cipher,
                    encryptedByKeyId: context.encryptedByKeyId,
                    encryptedFor: userId,
                )
            }
            let userKey = try await Data(base64Encoded: account.1.crypto().getUserEncryptionKey()) ?? Data()
            let encrypted = try await vault.ciphers().encryptLegacyAttachment(
                cipher: saved,
                attachment: AttachmentView(
                    id: attachmentId,
                    url: nil,
                    size: String(rawData.count),
                    sizeName: nil,
                    fileName: fileName,
                    key: nil,
                ),
                contents: rawData,
                userKey: userKey,
            )
            _ = try await account.0.saveAttachmentWithServer(cipher: saved, attachment: encrypted)
        } else {
            let saved = try guest.save(
                profile,
                attachment: (attachmentId, fileName, rawData),
            )
            try remember(profileId: saved.id, section: "document")
        }
    }

    private func fillPdfForm(data: Data, fileName: String) async {
        guard let profile = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first else {
            message = Localizations.vowkeySaveProfileBeforeFilling
            return
        }
        do {
            let (filledData, filledCount) = try NativeDecision.fillPDF(data: data, profile: profile)
            let stem = (fileName as NSString).deletingPathExtension
            let outName = "\(stem) (filled).pdf"
            let outURL = FileManager.default.temporaryDirectory.appendingPathComponent(outName)
            try filledData.write(to: outURL, options: .atomic)
            filledPdfURL = outURL
            message = Localizations.vowkeyFilledXFields(filledCount)
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

@available(iOS 16.0, *)
private struct DocumentPhotoPickerRow: View {
    let onPicked: (Data) -> Void
    @SwiftUI.State private var selectedPhotoItem: PhotosPickerItem?

    var body: some View {
        PhotosPicker(selection: $selectedPhotoItem, matching: .images) {
            Label {
                Text(Localizations.vowkeyChoosePhoto)
                    .fontWeight(.medium)
            } icon: {
                Image(systemName: "photo.on.rectangle")
            }
            .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
        }
        .accessibilityIdentifier("NativeVaultChoosePhotoButton")
        .onChange(of: selectedPhotoItem) { newItem in
            guard let newItem else { return }
            Task {
                if let data = try? await newItem.loadTransferable(type: Data.self) {
                    onPicked(data)
                }
                selectedPhotoItem = nil
            }
        }
    }
}

/// Local and synced Vowkey vault screen for logins, keys, environments, document reading, and form filling.
struct NativeVaultView: View {
    private enum FilePickerMode {
        case readDocument
        case fillPdf
    }

    @StateObject var model: NativeVaultModel
    @SwiftUI.State private var showingFileImporter = false
    @SwiftUI.State private var filePickerMode: FilePickerMode = .readDocument

    init(model: NativeVaultModel) {
        _model = StateObject(wrappedValue: model)
    }

    var body: some View {
        List {
            if let message = model.message {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: model.messageIsError ? "exclamationmark.circle.fill" : "checkmark.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(
                                model.messageIsError
                                    ? SharedAsset.Colors.badgeDangerText.swiftUIColor
                                    : SharedAsset.Colors.tintPrimary.swiftUIColor,
                            )
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
                        .accessibilityLabel(Localizations.copy)
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
                        Label(Localizations.lock, systemImage: "lock")
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
                            Text(Localizations.vowkeyVaultLockedTitle)
                                .font(.headline)
                                .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                        }
                        Text(Localizations.vowkeyVaultLockedSubtitle)
                            .font(.subheadline)
                            .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                        Button {
                            model.load()
                        } label: {
                            Label(Localizations.unlock, systemImage: "lock.open.fill")
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
        .navigationTitle(Localizations.vowkeyOnThisDevice)
        .task { model.load() }
        .fileImporter(
            isPresented: $showingFileImporter,
            allowedContentTypes: filePickerMode == .fillPdf ? [.pdf] : [.pdf, .image],
        ) { result in
            guard case let .success(url) = result else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            if filePickerMode == .fillPdf {
                model.fillPdfFile(data: data, fileName: url.lastPathComponent)
            } else {
                let isPDF = url.pathExtension.lowercased() == "pdf"
                model.captureFile(
                    data: data,
                    fileName: url.lastPathComponent,
                    mediaType: isPDF ? "application/pdf" : "image/jpeg",
                )
            }
        }
    }

    // MARK: Sections

    private var savedItemsSection: some View {
        Section(Localizations.vowkeySavedOnThisDevice) {
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
                        Text(Localizations.vowkeyNothingSavedYet)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                        Text(Localizations.vowkeyNothingSavedYetSubtitle)
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
        Section(Localizations.add) {
            Picker(Localizations.types, selection: $model.kind) {
                Text(Localizations.typeLogin).tag("login")
                Text(Localizations.vowkeyTypeKey).tag("key")
                Text(Localizations.vowkeyTypeEnvironment).tag("environment")
                Text(Localizations.typeIdentity).tag("profile")
            }
            .pickerStyle(.segmented)
            .padding(.vertical, 2)

            if model.kind == "key" {
                TextField(Localizations.name, text: $model.name)
                SecureField(Localizations.vowkeyTypeKey, text: $model.secret)
                Picker(Localizations.vowkeySendAs, selection: $model.sendStyle) {
                    Text("Bearer").tag("bearer")
                    Text("Header").tag("header")
                    Text("Basic").tag("basic")
                }
                TextField(Localizations.vowkeyAllowedHosts, text: $model.hosts)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                if model.sendStyle == "header" {
                    TextField(Localizations.vowkeyHeaderName, text: $model.headerName)
                        .textInputAutocapitalization(.never)
                }
                if model.sendStyle == "basic" {
                    TextField(Localizations.username, text: $model.basicUsername)
                        .textInputAutocapitalization(.never)
                }
            } else if model.kind == "environment" {
                TextField(Localizations.name, text: $model.name)
                TextField(Localizations.vowkeyVariable, text: $model.memberName)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                Picker(Localizations.vowkeyTypeKey, selection: $model.memberItemId) {
                    Text(Localizations.vowkeyChooseAKey).tag("")
                    ForEach(model.keys, id: \.id) {
                        Text($0.name).tag($0.id ?? "")
                    }
                }
            } else if model.kind == "profile" {
                TextField(Localizations.name, text: $model.profileName)
                TextField(Localizations.vowkeyDetail, text: $model.detailLabel)
                TextField(Localizations.value, text: $model.detailValue)
            } else {
                TextField(Localizations.name, text: $model.name)
                TextField(Localizations.username, text: $model.username)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField(Localizations.password, text: $model.password)
            }

            Button {
                model.save()
            } label: {
                Label {
                    Text(Localizations.save)
                        .fontWeight(.semibold)
                } icon: {
                    Image(systemName: "plus.circle.fill")
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultSaveButton")
        }
    }

    private var readDocumentSection: some View {
        Section {
            if #available(iOS 16.0, *) {
                DocumentPhotoPickerRow { data in
                    model.captureFile(data: data, fileName: "document.jpg", mediaType: "image/jpeg")
                }
            }

            Button {
                filePickerMode = .readDocument
                showingFileImporter = true
            } label: {
                Label {
                    Text(Localizations.vowkeyChooseFile)
                        .fontWeight(.medium)
                } icon: {
                    Image(systemName: "doc.badge.plus")
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultChooseFileButton")

            ZStack(alignment: .topLeading) {
                if model.captureText.isEmpty {
                    Text(Localizations.vowkeyCapturePlaceholder)
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
                Label {
                    Text(Localizations.vowkeySaveProfile)
                        .fontWeight(.semibold)
                } icon: {
                    Image(systemName: "doc.viewfinder")
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultSaveProfileButton")
        } header: {
            Text(Localizations.vowkeyReadADocument)
        }
    }

    private var fillFormSection: some View {
        Section(Localizations.vowkeyFillThisForm) {
            HStack {
                Text(Localizations.vowkeyFormSection)
                    .font(.subheadline)
                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    .frame(width: 84, alignment: .leading)
                TextField(Localizations.vowkeyApplicantPlaceholder, text: $model.formSection)
                    .font(.subheadline)
            }

            HStack {
                Text(Localizations.vowkeyFormField)
                    .font(.subheadline)
                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    .frame(width: 84, alignment: .leading)
                TextField(Localizations.vowkeyFieldLabelPlaceholder, text: $model.formLabel)
                    .font(.subheadline)
                    .accessibilityIdentifier("NativeVaultFieldLabelInput")
            }

            if model.profiles.count > 1 {
                Picker(Localizations.vowkeyWhoseDetails, selection: $model.selectedProfileId) {
                    ForEach(model.profiles, id: \.id) {
                        Text($0.name).tag($0.id ?? "")
                    }
                }
            }

            Button {
                model.fill()
            } label: {
                Label {
                    Text(Localizations.vowkeyFillAction)
                        .fontWeight(.semibold)
                } icon: {
                    Image(systemName: "arrow.right.doc.on.clipboard")
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultFillButton")

            Button {
                filePickerMode = .fillPdf
                showingFileImporter = true
            } label: {
                Label {
                    Text(Localizations.vowkeyFillPdfFile)
                        .fontWeight(.medium)
                } icon: {
                    Image(systemName: "doc.text.fill")
                }
                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
            }
            .accessibilityIdentifier("NativeVaultFillPdfButton")

            if #available(iOS 16.0, *), let filledPdfURL = model.filledPdfURL {
                ShareLink(item: filledPdfURL) {
                    Label {
                        Text(Localizations.vowkeyShareFilledPdf)
                            .fontWeight(.medium)
                    } icon: {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                }
                .accessibilityIdentifier("NativeVaultShareFilledPdfButton")
            }
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
            Localizations.vowkeyTypeKey
        case .environment:
            Localizations.vowkeyTypeEnvironment
        case .identity:
            Localizations.typeIdentity
        default:
            Localizations.typeLogin
        }
    }

    private func subtitle(for item: CipherView) -> String {
        if item.type == .login, let user = item.login?.username, !user.isEmpty {
            return user
        }
        if item.type == .identity {
            let count = NativeProfile.details(item).count
            return count == 1 ? Localizations.vowkeyOneDetail : Localizations.vowkeyXDetails(count)
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
