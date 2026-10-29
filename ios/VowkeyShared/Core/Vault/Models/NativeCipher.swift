import Foundation
import VowkeySdk

enum NativeCipher {
    static func make(type: VowkeySdk.CipherType, name: String = "", id: String? = nil) -> CipherView {
        CipherView(id: id, organizationId: nil, folderId: nil, collectionIds: [], key: nil,
                   name: name, notes: nil, type: type, login: nil, identity: nil, card: nil,
                   secureNote: nil, sshKey: nil, bankAccount: nil, driversLicense: nil, passport: nil,
                   apiKey: nil, environment: nil,
                   favorite: false, reprompt: .none, organizationUseTotp: false, edit: true,
                   permissions: nil, viewPassword: true, localData: nil, attachments: nil,
                   attachmentDecryptionFailures: nil, fields: nil, passwordHistory: nil,
                   creationDate: Date(), deletedDate: nil, revisionDate: Date(), archivedDate: nil, partial: false)
    }

    static func replacing(_ cipher: CipherView, id: String? = nil, name: String? = nil, notes: String? = nil,
                          login: LoginView? = nil, apiKey: ApiKeyView? = nil, environment: EnvironmentView? = nil,
                          identity: IdentityView? = nil, fields: [FieldView]? = nil,
                          attachments: [AttachmentView]? = nil) -> CipherView {
        CipherView(id: id ?? cipher.id, organizationId: cipher.organizationId, folderId: cipher.folderId,
                   collectionIds: cipher.collectionIds, key: cipher.key, name: name ?? cipher.name,
                   notes: notes ?? cipher.notes, type: cipher.type, login: login ?? cipher.login, identity: identity ?? cipher.identity,
                   card: cipher.card, secureNote: cipher.secureNote, sshKey: cipher.sshKey,
                   bankAccount: cipher.bankAccount, driversLicense: cipher.driversLicense, passport: cipher.passport,
                   apiKey: apiKey ?? cipher.apiKey, environment: environment ?? cipher.environment,
                   favorite: cipher.favorite, reprompt: cipher.reprompt, organizationUseTotp: cipher.organizationUseTotp,
                   edit: cipher.edit, permissions: cipher.permissions, viewPassword: cipher.viewPassword,
                   localData: cipher.localData, attachments: attachments ?? cipher.attachments,
                   attachmentDecryptionFailures: cipher.attachmentDecryptionFailures, fields: fields ?? cipher.fields,
                   passwordHistory: cipher.passwordHistory, creationDate: cipher.creationDate,
                   deletedDate: cipher.deletedDate, revisionDate: cipher.revisionDate,
                   archivedDate: cipher.archivedDate, partial: cipher.partial)
    }

    static func encryptedCarrier(_ encrypted: String, organizationId: String?, id: String = UUID().uuidString.lowercased()) -> Cipher {
        Cipher(id: id, organizationId: organizationId, folderId: nil, collectionIds: [], key: nil,
               name: encrypted, notes: nil, type: .secureNote, login: nil, identity: nil, card: nil,
               secureNote: nil, sshKey: nil, bankAccount: nil, driversLicense: nil, passport: nil,
               apiKey: nil, environment: nil,
               favorite: false, reprompt: .none, organizationUseTotp: false, edit: false,
               permissions: nil, viewPassword: true, localData: nil, attachments: nil, fields: nil,
               passwordHistory: nil, creationDate: Date(), deletedDate: nil, revisionDate: Date(),
               archivedDate: nil, data: nil, partialData: nil)
    }

    static func reference(_ cipher: CipherView) -> String? {
        guard let id = cipher.id else { return nil }
        if cipher.type == .apiKey { return "@vk:\(id)/key.value" }
        if cipher.type == .environment {
            return cipher.environment?.members.map { "\($0.name)=@vk:\($0.itemId)/key.value" }.joined(separator: "\n")
        }
        return nil
    }

    static func validate(name: String, key: ApiKeyView?, environment: EnvironmentView?, keys: Set<String>) throws {
        guard !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { throw NativeVaultError.invalidInput }
        if let key {
            guard ["bearer", "header", "basic"].contains(key.sendStyle ?? ""),
                  key.allowedHosts.allSatisfy({ !$0.isEmpty && !$0.contains(where: { $0.isWhitespace }) && !$0.contains("/") }),
                  key.sendStyle != "header" || (key.headerName?.range(of: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$", options: .regularExpression) != nil),
                  key.sendStyle != "basic" || key.basicUsername != nil else { throw NativeVaultError.invalidInput }
        }
        if let environment {
            guard Set(environment.members.map(\.name)).count == environment.members.count,
                  environment.members.allSatisfy({ !$0.name.isEmpty && !$0.name.contains("=") && !$0.name.contains("\0") && keys.contains($0.itemId) })
            else { throw NativeVaultError.invalidInput }
        }
    }
}

enum NativeVaultError: LocalizedError {
    case locked, invalidInput, unavailable, unreadable, storage, migrationConflict
    var errorDescription: String? {
        switch self {
        case .locked: "Unlock your vault to continue."
        case .invalidInput: "Check the name, key settings and environment references."
        case .unavailable: "The reading service is unavailable. Try again later."
        case .unreadable: "Couldn't read this document. Try a clearer photo."
        case .storage: "Couldn't save on this device. Free some space and try again."
        case .migrationConflict: "Couldn't finish syncing these items. Your local vault is still available."
        }
    }
}
