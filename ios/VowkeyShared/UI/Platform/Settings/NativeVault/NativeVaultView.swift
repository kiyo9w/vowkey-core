import SwiftUI
import VowkeySdk

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
    private let fill: ((CipherView) -> Void)?
    private var accountUser: String?
    init(services: (any HasCipherService & HasClientService & HasStateService & HasAPIService)? = nil, fill: ((CipherView) -> Void)? = nil) {
        account = services.map { ($0.cipherService, $0.clientService, $0.stateService, $0.apiService) }
        self.fill = fill
    }

    func load() {
        Task { await reload() }
    }

    private func reload() async {
        do {
            if let account, let userId = try? await account.2.getActiveAccountId(), try await account.2.isAuthenticated(userId: userId) {
                accountUser = userId
                let key = try await account.1.crypto().getUserEncryptionKey()
                guard let userKey = Data(base64Encoded: key) else { throw NativeVaultError.locked }
                items = try await account.0.fetchAllCiphers().filter { $0.deletedDate == nil }.compactMap { cipher in
                    try? account.1.vault(for: userId).ciphers().decryptLegacyCipher(cipher: cipher, userKey: userKey)
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

    func lock() { guest.lock(); accountUser = nil; isUnlocked = false; items = [] }
    var profiles: [CipherView] { items.filter(NativeProfile.confirmed) }
    var keys: [CipherView] { items.filter { $0.type == .apiKey } }

    func save() { Task { await store(draft()) } }
    func capture() { Task { await readDocument() } }
    func fill() { Task { await matchForm() } }
    func select(_ item: CipherView) { fill?(item) }

    private func draft() -> CipherView? {
        do {
            let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
            switch kind {
            case "key":
                let key = ApiKeyView(value: secret, sendStyle: sendStyle,
                    allowedHosts: hosts.split { $0.isWhitespace || $0 == "," }.map(String.init),
                    headerName: headerName.nilIfEmpty, basicUsername: basicUsername.nilIfEmpty)
                try NativeCipher.validate(name: trimmed, key: key, environment: nil, keys: [])
                return NativeCipher.replacing(NativeCipher.make(type: .apiKey, name: trimmed), apiKey: key)
            case "environment":
                let environment = EnvironmentView(members: [EnvironmentMember(name: memberName, itemId: memberItemId)])
                try NativeCipher.validate(name: trimmed, key: nil, environment: environment, keys: Set(keys.compactMap(\.id)))
                return NativeCipher.replacing(NativeCipher.make(type: .environment, name: trimmed), environment: environment)
            case "profile": return try NativeProfile.typed(name: profileName, rows: [(detailLabel, detailValue)])
            default:
                guard !trimmed.isEmpty, !username.isEmpty, !password.isEmpty else { throw NativeVaultError.invalidInput }
                return NativeCipher.replacing(NativeCipher.make(type: .login, name: trimmed), login: LoginView(
                    username: username, password: password, passwordRevisionDate: nil, uris: nil, totp: nil, autofillOnPageLoad: nil, fido2Credentials: nil))
            }
        } catch { message = (error as? LocalizedError)?.errorDescription; return nil }
    }

    private func store(_ view: CipherView?) async {
        guard let view else { return }
        do {
            if let account, let userId = accountUser {
                let context = try await account.1.vault(for: userId).ciphers().encrypt(cipherView: view)
                try await account.0.addCipherWithServer(context.cipher, encryptedByKeyId: context.encryptedByKeyId, encryptedFor: userId)
            } else { _ = try guest.save(view) }
            name = ""; username = ""; password = ""; secret = ""; hosts = ""; headerName = ""; basicUsername = ""
            memberName = ""; memberItemId = ""; profileName = ""; detailLabel = ""; detailValue = ""
            await reload()
        } catch { message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
    }

    private func readDocument() async {
        guard !captureText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { message = NativeVaultError.unreadable.errorDescription; return }
        do {
            let read = try await NativeDecision.read(text: captureText, account: account, userId: accountUser, installationId: guest.installationId)
            let attachmentId = UUID().uuidString.lowercased()
            let profile = try NativeProfile.captured(read, fileName: "capture.txt", mediaType: "text/plain", attachmentId: attachmentId)
            if let account, let userId = accountUser {
                let context = try await account.1.vault(for: userId).ciphers().encrypt(cipherView: profile)
                let saved = try await account.0.addCipherWithServer(context.cipher, encryptedByKeyId: context.encryptedByKeyId, encryptedFor: userId)
                let encrypted = try account.1.vault(for: userId).ciphers().encryptLegacyAttachment(
                    cipher: saved, attachment: AttachmentView(id: attachmentId, url: nil, size: String(captureText.utf8.count), sizeName: nil, fileName: "capture.txt", key: nil),
                    contents: Data(captureText.utf8), userKey: Data(base64Encoded: try await account.1.crypto().getUserEncryptionKey()) ?? Data())
                _ = try await account.0.saveAttachmentWithServer(cipher: saved, attachment: encrypted)
            } else {
                let saved = try guest.save(profile, attachment: (attachmentId, "capture.txt", Data(captureText.utf8)))
                try remember(profileId: saved.id, section: "document")
            }
            captureText = ""
            await reload()
        } catch { message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
    }

    private func matchForm() async {
        let label = formLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { message = NativeVaultError.invalidInput.errorDescription; return }
        do {
            if let value = try await NativeDecision.match(label: label, section: formSection, profiles: profiles, account: account, userId: accountUser, installationId: guest.installationId) {
                message = value; return
            }
            guard let profile = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first else { message = "Save a profile before filling."; return }
            guard let value = matched(label, profile: profile) else { message = NativeVaultError.unavailable.errorDescription; return }
            try remember(profileId: profile.id, section: formSection, signature: "\(formSection)|\(label)")
            message = value
        } catch { message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription }
    }

    private func matched(_ label: String, profile: CipherView) -> String? {
        NativeProfile.details(profile).first {
            ($0["label"] as? String)?.localizedCaseInsensitiveCompare(label) == .orderedSame && ($0["agentRule"] as? String) != "never"
        }.flatMap { NativeProfile.value($0) }
    }
    private func remember(profileId: String?, section: String, signature: String? = nil) throws {
        guard let profileId else { return }
        let id = UUID().uuidString.lowercased()
        try guest.saveSideRecord("form-binding", id: id, value: [
            "v": 1, "id": id, "formSignature": signature ?? section, "sectionId": section,
            "profileCipherId": profileId, "updatedAt": AgentManagementDate.string(Date()),
        ])
    }
}

private extension String { var nilIfEmpty: String? { isEmpty ? nil : self } }

struct NativeVaultView: View {
    @StateObject var model: NativeVaultModel
    var body: some View {
        List {
            if let message = model.message { Section { Text(message).textSelection(.enabled) } }
            if model.isUnlocked {
                Section("Saved on this device") {
                    if model.items.isEmpty { Text("Nothing saved yet").foregroundColor(.secondary) }
                    ForEach(model.items, id: \.id) { item in
                        Button { model.select(item) } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(item.name)
                                Text(item.type == .apiKey ? "Key" : item.type == .environment ? "Environment" : item.type == .identity ? "Profile" : "Login")
                                    .font(.subheadline).foregroundColor(.secondary)
                            }
                        }
                    }
                }
                Section("Add") {
                    Picker("Type", selection: $model.kind) {
                        Text("Login").tag("login"); Text("Key").tag("key")
                        Text("Environment").tag("environment"); Text("Profile").tag("profile")
                    }
                    if model.kind == "key" {
                        TextField("Name", text: $model.name)
                        SecureField("Key", text: $model.secret)
                        Picker("Send as", selection: $model.sendStyle) {
                            Text("Bearer").tag("bearer"); Text("Header").tag("header"); Text("Basic").tag("basic")
                        }
                        TextField("Allowed hosts", text: $model.hosts)
                        if model.sendStyle == "header" { TextField("Header name", text: $model.headerName) }
                        if model.sendStyle == "basic" { TextField("Username", text: $model.basicUsername) }
                    } else if model.kind == "environment" {
                        TextField("Name", text: $model.name)
                        TextField("Variable", text: $model.memberName)
                        Picker("Key", selection: $model.memberItemId) {
                            Text("Choose a key").tag("")
                            ForEach(model.keys, id: \.id) { Text($0.name).tag($0.id ?? "") }
                        }
                    } else if model.kind == "profile" {
                        TextField("Name", text: $model.profileName)
                        TextField("Detail", text: $model.detailLabel)
                        TextField("Value", text: $model.detailValue)
                    } else {
                        TextField("Name", text: $model.name)
                        TextField("Username", text: $model.username).textInputAutocapitalization(.never)
                        SecureField("Password", text: $model.password)
                    }
                    Button("Save") { model.save() }
                }
                Section("Read a document") {
                    TextField("Label: value", text: $model.captureText, axis: .vertical)
                    Button("Save profile") { model.capture() }
                }
                Section("Fill this form") {
                    TextField("Section", text: $model.formSection)
                    TextField("Field label", text: $model.formLabel)
                    if model.profiles.count > 1 {
                        Picker("Whose details", selection: $model.selectedProfileId) {
                            ForEach(model.profiles, id: \.id) { Text($0.name).tag($0.id ?? "") }
                        }
                    }
                    Button("Fill") { model.fill() }
                }
                Section { Button("Lock", role: .destructive) { model.lock() } }
            } else { Section { Button("Unlock") { model.load() } } }
        }
        .navigationTitle("On this device")
        .task { model.load() }
    }
}
