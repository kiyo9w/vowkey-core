import CryptoKit
import Foundation
import Networking
import VowkeySdk

enum GuestVaultMigrationError: LocalizedError {
    case anotherAccount, unavailable, unverified, unsupported(String)
    var errorDescription: String? {
        switch self {
        case .anotherAccount: "Resume this migration with the original account."
        case .unavailable: "The migration journal is unavailable. The local vault is retained."
        case .unverified: "A migrated item or attachment could not be verified. Your local vault is retained."
        case let .unsupported(message): message
        }
    }
}

/// Persists the target account and each exact request before posting it. A retry reuses that body,
/// its hash, and the server row returned for `migrationId`/`localResourceId`/`requestHash`.
enum GuestVaultMigration {
    @MainActor
    static func attach(api: APIService, client: ClientService, userId: String) async throws {
        let vault = NativeLocalVault.shared
        try vault.unlock()
        let hasWork = try (vault.hasItems || vault.sideRecord("migration", id: vault.installationId) != nil)
        guard hasWork else { return }
        let encoded = try await client.crypto().getUserEncryptionKey()
        guard let accountKey = Data(base64Encoded: encoded), accountKey.count == 64 else { throw NativeVaultError.locked }
        let transport = MigrationHTTP(api: api, userId: userId)
        vault.setMigrating(true)
        defer { vault.setMigrating(false) }
        var journal = try load(vault, userId: userId, accountKey: accountKey)
        try await snapshot(&journal, vault: vault, userId: userId, accountKey: accountKey)
        try await upload(&journal, vault: vault, transport: transport)
        try await rewrite(&journal, vault: vault, transport: transport, userId: userId, accountKey: accountKey)
        try await bindings(&journal, vault: vault, transport: transport, userId: userId, accountKey: accountKey)
        if try await commit(&journal, vault: vault, userId: userId, accountKey: accountKey) == false {
            try? await transport.send(.post, "/accounts/guest-attached", ["newAccount": journal["keyAdopted"] as? Bool == true])
        }
    }

    @MainActor
    private static func load(_ vault: NativeLocalVault, userId: String, accountKey: Data) throws -> [String: Any] {
        if let saved = try vault.sideRecord("migration", id: vault.installationId) {
            guard saved["targetUserId"] as? String == userId else { throw GuestVaultMigrationError.anotherAccount }
            return saved
        }
        let local = try vault.unlockedKey()
        let adopted = local == accountKey
        let journal: [String: Any] = [
            "v": 1, "migrationId": UUID().uuidString.lowercased(),
            "mode": adopted ? "new-account" : "existing-account",
            "targetUserId": userId, "keyAdopted": adopted,
            "installationId": vault.installationId, "phase": "snapshot",
            "items": [String: Any](), "formBindings": [String: Any](),
        ]
        try vault.saveSideRecord("migration", id: vault.installationId, value: journal)
        return journal
    }

    @MainActor
    private static func snapshot(_ journal: inout [String: Any], vault: NativeLocalVault, userId: String, accountKey: Data) async throws {
        var items = dictionary(journal["items"])
        for cipher in try vault.encryptedCiphers() {
            guard let id = cipher.id else { throw GuestVaultMigrationError.unavailable }
            let previous = dictionary(items[id])
            if previous["status"] as? String == "confirmed" { continue }
            let rewrapped = journal["keyAdopted"] as? Bool == true ? cipher : try vault.rewrap(cipher, key: accountKey)
            var body = try wire(rewrapped, userId: userId)
            body["encryptedByKeyId"] = NSNull()
            body["migrationPending"] = true
            body.removeValue(forKey: "attachments")
            body.removeValue(forKey: "attachments2")
            var attachments: [String: Any] = [:]
            for attachment in rewrapped.attachments ?? [] {
                guard let attachmentId = attachment.id, let key = attachment.key, let name = attachment.fileName else {
                    throw GuestVaultMigrationError.unavailable
                }
                let bytes = try vault.encryptedAttachment(attachmentId)
                let checksum = sha256(bytes)
                let attachmentBody: [String: Any] = ["key": key, "fileName": name, "fileSize": bytes.count, "bytesChecksum": checksum]
                let kept = dictionary(dictionary(previous["attachments"])[attachmentId])
                attachments[attachmentId] = kept["targetAttachmentId"] != nil ? kept : [
                    "status": "pending", "body": attachmentBody, "requestHash": hash(attachmentBody), "bytesChecksum": checksum,
                ]
            }
            let inFlight = previous["status"] as? String == "posting" || previous["targetCipherId"] != nil
            items[id] = [
                "status": inFlight ? (previous["status"] as? String ?? "cipher-uploaded") : (cipher.deletedDate == nil ? "pending" : "local-trash"),
                "targetCipherId": previous["targetCipherId"] as Any,
                "body": inFlight ? previous["body"] as Any : body,
                "requestHash": inFlight ? previous["requestHash"] as Any : hash(body),
                "storedCipher": try JSONSerialization.jsonObject(with: NativeLocalVault.encoder.encode(CipherDetailsResponseModel(cipher: rewrapped))),
                "attachments": attachments, "finalBody": previous["finalBody"] as Any,
            ]
        }
        journal["items"] = items
        journal["phase"] = "upload"
        try vault.saveSideRecord("migration", id: vault.installationId, value: journal)
    }

    @MainActor
    private static func upload(_ journal: inout [String: Any], vault: NativeLocalVault, transport: MigrationHTTP) async throws {
        var items = dictionary(journal["items"])
        for id in items.keys.sorted() {
            var item = dictionary(items[id])
            let status = item["status"] as? String ?? "pending"
            if ["waiting-for-type", "local-trash", "confirmed"].contains(status) { continue }
            if status == "pending" || status == "posting" {
                item["status"] = "posting"
                try save(&journal, items: &items, id: id, item: item, vault: vault)
                do {
                    let created = try await transport.send(.post, "/ciphers", identity(dictionary(item["body"]), journal, id, item["requestHash"] as? String ?? ""))
                    guard let remote = created["id"] as? String else { throw GuestVaultMigrationError.unavailable }
                    item["targetCipherId"] = remote
                    item["status"] = "cipher-uploaded"
                } catch let error as MigrationHTTP.Failure where error.status == 400 || error.status == 422 {
                    item["status"] = "waiting-for-type"
                    item["error"] = error.message
                }
                try save(&journal, items: &items, id: id, item: item, vault: vault)
                if item["status"] as? String == "waiting-for-type" { continue }
            }
            guard let target = item["targetCipherId"] as? String else { throw GuestVaultMigrationError.unavailable }
            var attachments = dictionary(item["attachments"])
            for attachmentId in attachments.keys.sorted() {
                var attachment = dictionary(attachments[attachmentId])
                if attachment["status"] as? String == "confirmed" { continue }
                attachment["status"] = "posting"
                attachments[attachmentId] = attachment
                item["attachments"] = attachments
                try save(&journal, items: &items, id: id, item: item, vault: vault)
                let allocated = try await transport.send(.post, "/ciphers/\(target)/attachment/v2", identity(dictionary(attachment["body"]), journal, attachmentId, attachment["requestHash"] as? String ?? ""))
                guard let remoteId = allocated["attachmentId"] as? String else { throw GuestVaultMigrationError.unavailable }
                attachment["targetAttachmentId"] = remoteId
                attachments[attachmentId] = attachment
                item["attachments"] = attachments
                try save(&journal, items: &items, id: id, item: item, vault: vault)
                let bytes = try vault.encryptedAttachment(attachmentId)
                try await transport.upload(cipherId: target, attachmentId: remoteId, bytes: bytes, fileName: dictionary(attachment["body"])["fileName"] as? String ?? "file", url: allocated["url"] as? String)
                let downloaded = try await transport.download(cipherId: target, attachmentId: remoteId)
                guard sha256(downloaded) == attachment["bytesChecksum"] as? String else { throw GuestVaultMigrationError.unverified }
                attachment["status"] = "confirmed"
                attachments[attachmentId] = attachment
            }
            item["attachments"] = attachments
            try save(&journal, items: &items, id: id, item: item, vault: vault)
        }
    }

    @MainActor
    private static func rewrite(_ journal: inout [String: Any], vault: NativeLocalVault, transport: MigrationHTTP, userId: String, accountKey: Data) async throws {
        journal["phase"] = "rewrite"
        try vault.saveSideRecord("migration", id: vault.installationId, value: journal)
        let cipherIds = map(journal, "targetCipherId")
        let attachmentIds = attachmentMap(journal)
        var items = dictionary(journal["items"])
        for id in items.keys.sorted() {
            var item = dictionary(items[id])
            let status = item["status"] as? String ?? ""
            if status == "waiting-for-type" || status == "local-trash" {
                item["finalCipher"] = try await remapped(item["storedCipher"], cipherIds: cipherIds, attachmentIds: attachmentIds, key: accountKey, vault: vault)
                items[id] = item
                continue
            }
            guard status != "confirmed", let target = item["targetCipherId"] as? String else { continue }
            let current = try await transport.send(.get, "/ciphers/\(target)", nil)
            let revision = current["vowkeyRevision"] as? Int ?? (current["vowkeyRevision"] as? NSNumber)?.intValue
            guard let revision, let revisionDate = current["revisionDate"] as? String else { throw GuestVaultMigrationError.unavailable }
            let remappedCipher = try await remapped(item["storedCipher"], cipherIds: cipherIds, attachmentIds: attachmentIds, key: accountKey, vault: vault)
            var body = try wire(Cipher(responseModel: try NativeLocalVault.decoder.decode(CipherDetailsResponseModel.self, from: JSONSerialization.data(withJSONObject: remappedCipher))), userId: userId)
            body["migrationPending"] = false
            body["lastKnownRevisionDate"] = revisionDate
            body["expectedRevision"] = revision
            item["finalBody"] = body
            try save(&journal, items: &items, id: id, item: item, vault: vault)
            if current["migrationPending"] as? Bool != false || !same(current, body) {
                _ = try await transport.send(.put, "/ciphers/\(target)", body)
            }
            let verified = try await transport.send(.get, "/ciphers/\(target)", nil)
            guard same(verified, body), verified["migrationPending"] as? Bool == false else { throw GuestVaultMigrationError.unverified }
            let verifiedModel = try NativeLocalVault.decoder.decode(CipherDetailsResponseModel.self, from: JSONSerialization.data(withJSONObject: verified))
            _ = try vault.client.vault().ciphers().decryptLegacyCipher(cipher: Cipher(responseModel: verifiedModel), userKey: accountKey)
            item["status"] = "confirmed"
            item["finalCipher"] = verified
            try save(&journal, items: &items, id: id, item: item, vault: vault)
        }
        journal["items"] = items
    }

    @MainActor
    private static func bindings(_ journal: inout [String: Any], vault: NativeLocalVault, transport: MigrationHTTP, userId: String, accountKey: Data) async throws {
        var saved = dictionary(journal["formBindings"])
        let cipherIds = map(journal, "targetCipherId")
        let attachmentIds = attachmentMap(journal)
        for (id, value) in try vault.sideRecords("form-binding") where saved[id] == nil {
            let rewritten = remap(value, cipherIds: cipherIds, attachmentIds: attachmentIds, oldScope: "local:\(vault.installationId)", newScope: userId) as? [String: Any] ?? [:]
            saved[id] = ["status": "pending", "payload": try vault.seal(rewritten, key: accountKey), "profileCipherId": rewritten["profileCipherId"] as Any]
            journal["formBindings"] = saved
            try vault.saveSideRecord("migration", id: vault.installationId, value: journal)
        }
        let items = dictionary(journal["items"])
        for id in saved.keys.sorted() {
            var binding = dictionary(saved[id])
            guard binding["status"] as? String != "confirmed", let localProfile = binding["profileCipherId"] as? String else { continue }
            if dictionary(items[localProfile])["status"] as? String == "waiting-for-type" {
                binding["status"] = "local-pending"
            } else {
                guard let payload = binding["payload"] as? String else { throw GuestVaultMigrationError.unavailable }
                _ = try await transport.send(.put, "/form-bindings/\(id)", [
                    "bindingId": id, "encryptedBinding": payload, "revision": 0,
                    "profileCipherId": cipherIds[localProfile] ?? localProfile,
                ])
                binding["status"] = "confirmed"
            }
            saved[id] = binding
            journal["formBindings"] = saved
            try vault.saveSideRecord("migration", id: vault.installationId, value: journal)
        }
    }

    @MainActor
    private static func commit(_ journal: inout [String: Any], vault: NativeLocalVault, userId: String, accountKey: Data) async throws -> Bool {
        let items = dictionary(journal["items"])
        let pending = items.contains { dictionary($0.value)["status"] as? String == "waiting-for-type" }
        for (id, value) in items where dictionary(value)["status"] as? String == "waiting-for-type" {
            let cipher = dictionary(value)["finalCipher"] ?? dictionary(value)["storedCipher"] ?? [:]
            let model = try NativeLocalVault.decoder.decode(CipherDetailsResponseModel.self, from: JSONSerialization.data(withJSONObject: cipher))
            let protected = try vault.client.vault().ciphers().encryptLegacyCipher(
                view: try vault.client.vault().ciphers().decryptLegacyCipher(cipher: Cipher(responseModel: model), userKey: accountKey), userKey: accountKey)
            try vault.putCipher(id: id, data: NativeLocalVault.encoder.encode(CipherDetailsResponseModel(cipher: protected)))
        }
        let confirmed = items.compactMap { id, value in dictionary(value)["status"] as? String == "confirmed" ? id : nil }
        journal["phase"] = "verified"
        journal["pending"] = pending
        try vault.saveSideRecord("migration-account", id: userId, value: journal)
        try vault.finishMigration(ids: confirmed)
        if !pending { try vault.removeSideRecord("migration", id: vault.installationId) }
        return pending
    }

    @MainActor
    private static func save(_ journal: inout [String: Any], items: inout [String: Any], id: String, item: [String: Any], vault: NativeLocalVault) throws {
        items[id] = item
        journal["items"] = items
        try vault.saveSideRecord("migration", id: vault.installationId, value: journal)
    }

    @MainActor
    private static func remapped(_ stored: Any?, cipherIds: [String: String], attachmentIds: [String: String], key: Data, vault: NativeLocalVault) async throws -> Any {
        let model = try NativeLocalVault.decoder.decode(CipherDetailsResponseModel.self, from: JSONSerialization.data(withJSONObject: stored ?? [:]))
        let view = try vault.client.vault().ciphers().decryptLegacyCipher(cipher: Cipher(responseModel: model), userKey: key)
        let members = view.environment?.members.map { EnvironmentMember(name: $0.name, itemId: cipherIds[$0.itemId] ?? $0.itemId) }
        let fields = view.fields?.map { field -> FieldView in
            guard field.name == "vk.meta", let value = field.value, let object = try? JSONSerialization.jsonObject(with: Data(value.utf8)) else { return field }
            let json = (try? JSONSerialization.data(withJSONObject: remap(object, cipherIds: cipherIds, attachmentIds: attachmentIds, oldScope: "", newScope: ""))).map { String(decoding: $0, as: UTF8.self) } ?? value
            return FieldView(name: field.name, value: json, type: field.type, linkedId: field.linkedId)
        }
        let notes = view.notes.map { rewriteVkRefs($0, cipherIds: cipherIds) }
        let attachments = view.attachments?.map { AttachmentView(id: attachmentIds[$0.id ?? ""] ?? $0.id, url: $0.url, size: $0.size, sizeName: $0.sizeName, fileName: $0.fileName, key: $0.key) }
        let updated = NativeCipher.replacing(view, id: cipherIds[view.id ?? ""] ?? view.id, notes: notes, environment: members.map(EnvironmentView.init), fields: fields, attachments: attachments)
        return try JSONSerialization.jsonObject(with: NativeLocalVault.encoder.encode(CipherDetailsResponseModel(cipher: try vault.client.vault().ciphers().encryptLegacyCipher(view: updated, userKey: key))))
    }
}

private struct MigrationHTTP {
    struct Failure: Error { let status: Int; let message: String }
    let api: APIService
    let userId: String
    func send(_ method: HTTPMethod, _ path: String, _ body: [String: Any]?) async throws -> [String: Any] {
        guard try await api.stateService.getActiveAccountId() == userId else { throw GuestVaultMigrationError.anotherAccount }
        let token = try await api.accountTokenProvider.getToken() ?? ""
        let data = try body.map { try JSONSerialization.data(withJSONObject: $0) }
        let response = try await api.apiUnauthenticatedService.send(MigrationRequest(path: path, method: method, body: data, token: token))
        return (try JSONSerialization.jsonObject(with: response.data) as? [String: Any]) ?? [:]
    }
    func upload(cipherId: String, attachmentId: String, bytes: Data, fileName: String, url: String?) async throws {
        guard let url = URL(string: url ?? "") else { throw GuestVaultMigrationError.unavailable }
        try await api.uploadCipherAttachment(attachmentId: attachmentId, cipherId: cipherId, data: bytes, fileName: fileName, type: .direct, url: url)
    }
    func download(cipherId: String, attachmentId: String) async throws -> Data {
        guard let file = try await api.downloadAttachmentData(from: try await api.downloadAttachment(withId: attachmentId, cipherId: cipherId).url) else { throw GuestVaultMigrationError.unverified }
        return try Data(contentsOf: file)
    }
}

private struct MigrationRequest: Request {
    struct Response: Networking.Response { let data: Data; init(response: HTTPResponse) throws { data = response.body } }
    let path: String
    let method: HTTPMethod
    let body: Data?
    let token: String
    var headers: [String: String] { ["Authorization": "Bearer \(token)", "Content-Type": "application/json"] }
    func validate(_ response: HTTPResponse) throws {
        guard (200..<300).contains(response.statusCode) else {
            throw MigrationHTTP.Failure(status: response.statusCode, message: String(decoding: response.body, as: UTF8.self))
        }
    }
}

private func dictionary(_ value: Any?) -> [String: Any] { value as? [String: Any] ?? [:] }
private func identity(_ body: [String: Any], _ journal: [String: Any], _ localId: String, _ hash: String) -> [String: Any] {
    var copy = body
    copy["migrationId"] = journal["migrationId"]; copy["localResourceId"] = localId; copy["requestHash"] = hash
    return copy
}
private func map(_ journal: [String: Any], _ key: String) -> [String: String] {
    Dictionary(uniqueKeysWithValues: dictionary(journal["items"]).compactMap { id, value in (dictionary(value)[key] as? String).map { (id, $0) } })
}
private func attachmentMap(_ journal: [String: Any]) -> [String: String] {
    dictionary(journal["items"]).values.reduce(into: [:]) { result, value in
        for (id, attachment) in dictionary(dictionary(value)["attachments"]) {
            if let remote = dictionary(attachment)["targetAttachmentId"] as? String { result[id] = remote }
        }
    }
}
private func wire(_ value: some Encodable) throws -> [String: Any] {
    var body = try JSONSerialization.jsonObject(with: JSONEncoder.defaultEncoder.encode(value)) as? [String: Any] ?? [:]
    if let organization = body.removeValue(forKey: "organizationID") { body["organizationId"] = organization }
    return body
}
private func wire(_ cipher: Cipher, userId: String) throws -> [String: Any] {
    var body = try wire(CipherRequestModel(cipher: cipher, encryptedFor: userId))
    body["encryptedFor"] = userId
    return body
}
private func hash(_ body: [String: Any]) -> String { sha256(Data(canonical(body).utf8)) }
private func sha256(_ data: Data) -> String { SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined() }
private func canonical(_ value: Any) -> String {
    if value is NSNull { return "null" }
    if let value = value as? String { return jsonString(value) }
    if let value = value as? Bool { return value ? "true" : "false" }
    if let value = value as? Int { return String(value) }
    if let value = value as? NSNumber { return value.stringValue }
    if let value = value as? [Any] { return "[\(value.map(canonical).joined(separator: ","))]" }
    if let value = value as? [String: Any] {
        return "{\(value.keys.sorted().map { "\(jsonString($0)):\(canonical(value[$0] ?? NSNull()))" }.joined(separator: ","))}"
    }
    return "null"
}
private func jsonString(_ value: String) -> String {
    let encoded = (try? JSONSerialization.data(withJSONObject: [value])).flatMap { String(decoding: $0, as: UTF8.self) } ?? "[\"\"]"
    return String(encoded.dropFirst().dropLast())
}
private func same(_ actual: [String: Any], _ expected: [String: Any]) -> Bool {
    ["type", "name", "notes", "key", "fields", "login", "card", "identity", "secureNote", "sshKey", "bankAccount", "driversLicense", "passport", "apiKey", "environment"].allSatisfy {
        canonical(actual[$0] ?? NSNull()) == canonical(expected[$0] ?? NSNull())
    }
}
private let cipherJoins: Set<String> = ["cipherId", "sourceCipherId", "profileId", "profileCipherId", "originCipherId", "targetCipherId", "itemId", "environmentId", "cipherIds", "sourceCipherIds", "itemIds", "enabledItemIds", "sectionProfiles"]
private let attachmentJoins: Set<String> = ["attachmentId", "originAttachmentId", "targetAttachmentId"]
private func remap(_ value: Any, cipherIds: [String: String], attachmentIds: [String: String], oldScope: String, newScope: String, property: String = "") -> Any {
    if let text = value as? String {
        if cipherJoins.contains(property) { return cipherIds[text] ?? text }
        if attachmentJoins.contains(property) { return attachmentIds[text] ?? text }
        if (property == "vaultScopeId" || property == "scopeId"), text == oldScope { return newScope }
        return rewriteVkRefs(text, cipherIds: cipherIds)
    }
    if let values = value as? [Any] { return values.map { remap($0, cipherIds: cipherIds, attachmentIds: attachmentIds, oldScope: oldScope, newScope: newScope, property: property) } }
    if let object = value as? [String: Any] {
        return Dictionary(uniqueKeysWithValues: object.map { key, entry in
            (key, remap(entry, cipherIds: cipherIds, attachmentIds: attachmentIds, oldScope: oldScope, newScope: newScope, property: property == "sectionProfiles" ? property : key))
        })
    }
    return value
}

private let vkRefRegex = try! NSRegularExpression(pattern: "@vk:([^/\\s]+)/")
private func rewriteVkRefs(_ text: String, cipherIds: [String: String]) -> String {
    let ns = text as NSString
    let matches = vkRefRegex.matches(in: text, range: NSRange(location: 0, length: ns.length))
    guard !matches.isEmpty else { return text }
    let out = NSMutableString(string: text)
    for match in matches.reversed() {
        let token = ns.substring(with: match.range(at: 1))
        if let mapped = cipherIds[token] {
            out.replaceCharacters(in: match.range, with: "@vk:\(mapped)/")
        }
    }
    return out as String
}
