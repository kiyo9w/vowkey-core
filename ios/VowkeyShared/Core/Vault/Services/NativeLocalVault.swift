import Foundation
import Security
import SQLite3
import VowkeyKit
import VowkeySdk

private final class NativeGuestTokens: ClientManagedTokens {
    func getAccessToken() async -> String? { nil }
}

@MainActor
final class NativeLocalVault {
    static let shared = NativeLocalVault()
    let client = Client(tokenProvider: NativeGuestTokens(), settings: nil)
    private var database: OpaquePointer?
    private var userKey: Data?
    private var directory: URL?
    private let defaults = UserDefaults(suiteName: Bundle.main.groupIdentifier) ?? .standard
    private let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
    private(set) var migrating = false
    var installationId: String { defaults.string(forKey: "vowkey.local.installationId") ?? "" }
    var hasItems: Bool { (try? records(kind: "cipher").isEmpty == false) ?? false }
    var isUnlocked: Bool { userKey != nil }

    static var encoder: JSONEncoder {
        let value = JSONEncoder()
        value.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        value.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            let format = ISO8601DateFormatter()
            format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try container.encode(format.string(from: date))
        }
        return value
    }
    static var decoder: JSONDecoder {
        let value = JSONDecoder()
        value.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = AgentManagementDate.parse(text) else { throw NativeVaultError.invalidInput }
            return date
        }
        return value
    }

    func unlock() throws {
        try openDatabase()
        if userKey != nil { return }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "Vowkey", kSecAttrAccount as String: "localUserKey",
            kSecAttrAccessGroup as String: Bundle.main.keychainAccessGroup,
            kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess, let key = result as? Data, key.count == 64 { userKey = key; return }
        guard status == errSecItemNotFound, !hasItems, installationId.isEmpty else { throw NativeVaultError.locked }
        var key = Data(count: 64)
        guard key.withUnsafeMutableBytes({ SecRandomCopyBytes(kSecRandomDefault, 64, $0.baseAddress!) }) == errSecSuccess else { throw NativeVaultError.storage }
        var attributes = query
        attributes.removeValue(forKey: kSecReturnData as String)
        attributes.removeValue(forKey: kSecMatchLimit as String)
        attributes[kSecValueData as String] = key
        attributes[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        guard SecItemAdd(attributes as CFDictionary, nil) == errSecSuccess else { throw NativeVaultError.locked }
        defaults.set(UUID().uuidString.lowercased(), forKey: "vowkey.local.installationId")
        userKey = key
    }

    func lock() { userKey?.resetBytes(in: 0..<64); userKey = nil }

    func ciphers() throws -> [CipherView] {
        let key = try unlockedKey()
        return try records(kind: "cipher").map { _, data in
            let model = try Self.decoder.decode(CipherDetailsResponseModel.self, from: data)
            guard !model.migrationPending else { throw NativeVaultError.migrationConflict }
            return try client.vault().ciphers().decryptLegacyCipher(cipher: Cipher(responseModel: model), userKey: key)
        }
    }

    func encryptedCiphers() throws -> [Cipher] {
        try records(kind: "cipher").map { _, data in
            Cipher(responseModel: try Self.decoder.decode(CipherDetailsResponseModel.self, from: data))
        }
    }

    @discardableResult
    func save(_ view: CipherView, attachment: (id: String, name: String, bytes: Data)? = nil) throws -> CipherView {
        guard !migrating else { throw NativeVaultError.migrationConflict }
        let key = try unlockedKey()
        let id = view.id ?? UUID().uuidString.lowercased()
        var updated = NativeCipher.replacing(view, id: id)
        var encrypted = try client.vault().ciphers().encryptLegacyCipher(view: updated, userKey: key)
        var staged: (String, Data)?
        if let attachment {
            let result = try client.vault().ciphers().encryptLegacyAttachment(cipher: encrypted,
                attachment: AttachmentView(id: attachment.id, url: nil, size: String(attachment.bytes.count), sizeName: nil, fileName: attachment.name, key: nil),
                contents: attachment.bytes, userKey: key)
            let attachmentView = try client.vault().ciphers().decryptLegacyCipher(cipher: encrypted, userKey: key)
            let fullAttachment = AttachmentView(id: attachment.id, url: nil, size: result.attachment.size,
                sizeName: result.attachment.sizeName, fileName: attachment.name,
                key: try client.vault().ciphers().decryptLegacyCipher(cipher: try withAttachments(encrypted, [result.attachment]), userKey: key).attachments?.first?.key)
            updated = NativeCipher.replacing(attachmentView, attachments: (view.attachments ?? []) + [fullAttachment])
            encrypted = try client.vault().ciphers().encryptLegacyCipher(view: updated, userKey: key)
            staged = (attachment.id, result.contents)
        }
        let data = try Self.encoder.encode(CipherDetailsResponseModel(cipher: encrypted))
        if let (attachmentId, bytes) = staged {
            try put(kind: "blob-intent", id: attachmentId, data: Data(id.utf8))
            let path = try blobURL(attachmentId)
            try bytes.write(to: path, options: [.atomic, .completeFileProtection])
            let handle = try FileHandle(forWritingTo: path)
            try handle.synchronize(); try handle.close()
        }
        try transaction {
            try put(kind: "cipher", id: id, data: data)
            if let (attachmentId, _) = staged {
                try put(kind: "blob", id: attachmentId, data: Data(id.utf8))
                try remove(kind: "blob-intent", id: attachmentId)
            }
        }
        return try client.vault().ciphers().decryptLegacyCipher(cipher: encrypted, userKey: key)
    }

    func delete(_ view: CipherView) throws {
        guard !migrating, let id = view.id else { throw NativeVaultError.migrationConflict }
        _ = try unlockedKey()
        try transaction {
            try remove(kind: "cipher", id: id)
            for attachment in view.attachments ?? [] {
                if let attachmentId = attachment.id { try remove(kind: "blob", id: attachmentId) }
            }
        }
        for attachment in view.attachments ?? [] {
            if let id = attachment.id { try? FileManager.default.removeItem(at: blobURL(id)) }
        }
    }

    func attachmentBytes(cipherId: String, attachmentId: String) throws -> Data {
        guard let cipher = try encryptedCiphers().first(where: { $0.id == cipherId }),
              let attachment = cipher.attachments?.first(where: { $0.id == attachmentId }) else { throw NativeVaultError.unreadable }
        return try client.vault().ciphers().decryptLegacyAttachment(cipher: cipher, attachment: attachment,
            contents: Data(contentsOf: blobURL(attachmentId)), userKey: unlockedKey())
    }

    func encryptedAttachment(_ id: String) throws -> Data { try Data(contentsOf: blobURL(id)) }
    func retainAccountOriginal(userId: String, cipherId: String, attachmentId: String, bytes: Data) throws {
        let path = try accountOriginalURL(userId: userId, cipherId: cipherId, attachmentId: attachmentId)
        try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        try bytes.write(to: path, options: [.atomic, .completeFileProtection])
    }

    func accountOriginal(userId: String, cipherId: String, attachmentId: String) -> Data? {
        guard let path = try? accountOriginalURL(userId: userId, cipherId: cipherId, attachmentId: attachmentId),
              FileManager.default.fileExists(atPath: path.path) else { return nil }
        return try? Data(contentsOf: path)
    }
    func hasAccountOriginal(userId: String, cipherId: String, attachmentId: String) -> Bool {
        guard let path = try? accountOriginalURL(userId: userId, cipherId: cipherId, attachmentId: attachmentId) else { return false }
        return FileManager.default.fileExists(atPath: path.path)
    }

    func storedAccountOriginalIds(userId: String, cipherId: String) -> Set<String> {
        guard let directory = try? accountOriginalURL(userId: userId, cipherId: cipherId, attachmentId: "x")
            .deletingLastPathComponent() else { return [] }
        let names = (try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []
        return Set(names.filter { $0.hasSuffix(".encrypted") }.map { String($0.dropLast(".encrypted".count)) })
    }

    func deleteAccountOriginal(userId: String, cipherId: String, attachmentId: String) {
        guard let path = try? accountOriginalURL(userId: userId, cipherId: cipherId, attachmentId: attachmentId) else { return }
        try? FileManager.default.removeItem(at: path)
    }

    private func accountOriginalURL(userId: String, cipherId: String, attachmentId: String) throws -> URL {
        try openDatabase()
        guard let directory, Self.isStorageId(userId), Self.isStorageId(cipherId), Self.isStorageId(attachmentId) else {
            throw NativeVaultError.invalidInput
        }
        return directory.appendingPathComponent("account-originals", isDirectory: true)
            .appendingPathComponent(userId, isDirectory: true)
            .appendingPathComponent(cipherId, isDirectory: true)
            .appendingPathComponent(attachmentId + ".encrypted")
    }

    private static func isStorageId(_ id: String) -> Bool {
        !id.isEmpty && id.count <= 128 && id.unicodeScalars.allSatisfy { scalar in
            CharacterSet.alphanumerics.contains(scalar) || scalar == "-" || scalar == "_"
        }
    }
    func operation(_ id: String) throws -> [String: Any]? {
        guard let data = try records(kind: "operation").first(where: { $0.0 == id })?.1 else { return nil }
        let model = try Self.decoder.decode(CipherDetailsResponseModel.self, from: data)
        let view = try client.vault().ciphers().decryptLegacyCipher(cipher: Cipher(responseModel: model), userKey: unlockedKey())
        return try JSONSerialization.jsonObject(with: Data(view.name.utf8)) as? [String: Any]
    }
    func saveOperation(_ id: String, _ value: [String: Any]) throws {
        let json = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        let encrypted = try client.vault().ciphers().encryptLegacyCipher(view: NativeCipher.make(type: .secureNote, name: String(decoding: json, as: UTF8.self), id: id), userKey: unlockedKey())
        try put(kind: "operation", id: id, data: Self.encoder.encode(CipherDetailsResponseModel(cipher: encrypted)))
    }
    func sideRecord(_ kind: String, id: String) throws -> [String: Any]? {
        guard let data = try records(kind: kind).first(where: { $0.0 == id })?.1 else { return nil }
        let model = try Self.decoder.decode(CipherDetailsResponseModel.self, from: data)
        let view = try client.vault().ciphers().decryptLegacyCipher(cipher: Cipher(responseModel: model), userKey: unlockedKey())
        return try JSONSerialization.jsonObject(with: Data(view.name.utf8)) as? [String: Any]
    }
    func saveSideRecord(_ kind: String, id: String, value: [String: Any]) throws {
        let json = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        let encrypted = try client.vault().ciphers().encryptLegacyCipher(
            view: NativeCipher.make(type: .secureNote, name: String(decoding: json, as: UTF8.self), id: id), userKey: unlockedKey())
        try put(kind: kind, id: id, data: Self.encoder.encode(CipherDetailsResponseModel(cipher: encrypted)))
    }
    func seal(_ value: [String: Any], key: Data) throws -> String {
        let json = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys, .withoutEscapingSlashes])
        return try client.vault().ciphers().encryptLegacyCipher(
            view: NativeCipher.make(type: .secureNote, name: String(decoding: json, as: UTF8.self), id: UUID().uuidString.lowercased()), userKey: key).name ?? ""
    }
    func putCipher(id: String, data: Data) throws { try put(kind: "cipher", id: id, data: data) }
    func removeSideRecord(_ kind: String, id: String) throws { try remove(kind: kind, id: id) }
    func sideRecords(_ kind: String) throws -> [(String, [String: Any])] {
        try records(kind: kind).compactMap { id, _ in try sideRecord(kind, id: id).map { (id, $0) } }
    }
    func setMigrating(_ value: Bool) { migrating = value }
    func rewrap(_ cipher: Cipher, key: Data) throws -> Cipher {
        try client.vault().ciphers().rewrapLegacyCipherKey(cipher: cipher, oldUserKey: unlockedKey(), newUserKey: key)
    }
    func unlockedKey() throws -> Data { guard let userKey else { throw NativeVaultError.locked }; return userKey }
    func finishMigration(ids: [String]) throws {
        try transaction { for id in ids { try remove(kind: "cipher", id: id) } }
        migrating = false
    }

    private func openDatabase() throws {
        if database != nil { return }
        let root: URL
        if let groupRoot = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Bundle.main.groupIdentifier) {
            root = groupRoot
        } else if let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
            root = appSupport.appendingPathComponent("VowkeyGroupFallback", isDirectory: true)
        } else {
            throw NativeVaultError.storage
        }
        let directory = root.appendingPathComponent("local-vault-v1", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
            attributes: [.protectionKey: FileProtectionType.complete])
        self.directory = directory
        guard sqlite3_open_v2(directory.appendingPathComponent("vault.sqlite").path, &database,
                             SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_FULLMUTEX, nil) == SQLITE_OK else { throw NativeVaultError.storage }
        sqlite3_busy_timeout(database, 5000)
        try execute("PRAGMA journal_mode=WAL")
        try execute("PRAGMA synchronous=FULL")
        try execute("CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(kind,id))")
        for (id, _) in try records(kind: "blob-intent") {
            if !(try records(kind: "blob").contains { $0.0 == id }) { try? FileManager.default.removeItem(at: blobURL(id)) }
            try remove(kind: "blob-intent", id: id)
        }
    }
    private func blobURL(_ id: String) throws -> URL {
        guard Self.isStorageId(id), let directory else { throw NativeVaultError.invalidInput }
        return directory.appendingPathComponent(id + ".encrypted")
    }
    private func execute(_ sql: String) throws {
        guard sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK else { throw NativeVaultError.storage }
    }
    private func transaction(_ body: () throws -> Void) throws {
        try execute("BEGIN IMMEDIATE")
        do { try body(); try execute("COMMIT") } catch { try? execute("ROLLBACK"); throw error }
    }
    private func records(kind: String) throws -> [(String, Data)] {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "SELECT id,payload FROM records WHERE kind=? ORDER BY id", -1, &statement, nil) == SQLITE_OK else { throw NativeVaultError.storage }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, kind, -1, transient)
        var result: [(String, Data)] = []
        var status = sqlite3_step(statement)
        while status == SQLITE_ROW {
            let id = String(cString: sqlite3_column_text(statement, 0))
            let data = Data(bytes: sqlite3_column_blob(statement, 1), count: Int(sqlite3_column_bytes(statement, 1)))
            result.append((id, data)); status = sqlite3_step(statement)
        }
        guard status == SQLITE_DONE else { throw NativeVaultError.storage }
        return result
    }
    private func put(kind: String, id: String, data: Data) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "INSERT OR REPLACE INTO records(kind,id,payload) VALUES(?,?,?)", -1, &statement, nil) == SQLITE_OK else { throw NativeVaultError.storage }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, kind, -1, transient); sqlite3_bind_text(statement, 2, id, -1, transient)
        let status = data.withUnsafeBytes { sqlite3_bind_blob(statement, 3, $0.baseAddress, Int32(data.count), transient) }
        guard status == SQLITE_OK, sqlite3_step(statement) == SQLITE_DONE else { throw NativeVaultError.storage }
    }
    private func remove(kind: String, id: String) throws {
        var statement: OpaquePointer?
        guard sqlite3_prepare_v2(database, "DELETE FROM records WHERE kind=? AND id=?", -1, &statement, nil) == SQLITE_OK else { throw NativeVaultError.storage }
        defer { sqlite3_finalize(statement) }
        sqlite3_bind_text(statement, 1, kind, -1, transient); sqlite3_bind_text(statement, 2, id, -1, transient)
        guard sqlite3_step(statement) == SQLITE_DONE else { throw NativeVaultError.storage }
    }
    private func withAttachments(_ cipher: Cipher, _ attachments: [Attachment]) throws -> Cipher {
        let data = try Self.encoder.encode(CipherDetailsResponseModel(cipher: cipher))
        guard var object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NativeVaultError.invalidInput
        }
        object["attachments"] = try attachments.map {
            try JSONSerialization.jsonObject(with: Self.encoder.encode(AttachmentResponseModel(attachment: $0)))
        }
        let model = try Self.decoder.decode(CipherDetailsResponseModel.self,
            from: JSONSerialization.data(withJSONObject: object))
        return Cipher(responseModel: model)
    }
}
