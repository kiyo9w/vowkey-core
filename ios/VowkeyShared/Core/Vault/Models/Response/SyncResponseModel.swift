import Foundation
import Networking

/// API response model for the GET /sync request.
///
struct SyncResponseModel: JSONResponse, Equatable {
    // MARK: Properties

    /// The user's list of ciphers.
    @SupportedCipherList var ciphers: [CipherDetailsResponseModel]

    /// The user's list of collections.
    let collections: [CollectionDetailsResponseModel]

    /// Domain details.
    let domains: DomainsResponseModel?

    /// The user's list of folders.
    let folders: [FolderResponseModel]

    /// Policies that apply to the user. This is the legacy list, superseded by `policiesNew`.
    /// See `effectivePolicies`.
    let policies: [PolicyResponseModel]?

    /// The new policies list including accepted-state members from the server-side flag.
    /// See `effectivePolicies` for the fallback to `policies` when absent.
    let policiesNew: [PolicyResponseModel]?

    /// The user's profile.
    let profile: ProfileResponseModel?

    /// The user's list of sends.
    let sends: [SendResponseModel]

    /// The user's decryption info.
    let userDecryption: UserDecryptionResponseModel?

    // MARK: Computed Properties

    /// The effective list of policies for the user.
    ///
    /// Prefers `policiesNew` (which includes accepted-state members) over the legacy `policies`
    /// list, which is used when the server doesn't return `policiesNew`. Returns an empty list
    /// when neither is present.
    ///
    var effectivePolicies: [PolicyResponseModel] {
        policiesNew ?? policies ?? []
    }
}

/// Decode known item types independently so future types do not interrupt ordinary sync.
@propertyWrapper
struct SupportedCipherList: Codable, Equatable {
    let wrappedValue: [CipherDetailsResponseModel]

    init(wrappedValue: [CipherDetailsResponseModel]) {
        self.wrappedValue = wrappedValue
    }

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var ciphers: [CipherDetailsResponseModel] = []
        while !container.isAtEnd {
            let item = try container.decode(SupportedCipher.self)
            if let cipher = item.cipher {
                ciphers.append(cipher)
            }
        }
        wrappedValue = ciphers
    }

    func encode(to encoder: Encoder) throws {
        try wrappedValue.encode(to: encoder)
    }

    private struct SupportedCipher: Decodable {
        let cipher: CipherDetailsResponseModel?

        private enum CodingKeys: String, CodingKey {
            case type
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            let type = try container.decode(Int.self, forKey: .type)
            cipher = CipherType(rawValue: type) == nil ? nil : try CipherDetailsResponseModel(from: decoder)
        }
    }
}
