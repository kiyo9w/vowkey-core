import VowkeyKit
import VowkeySdk
import Foundation

// MARK: - ServerCommunicationConfigKeychainRepository

/// A service that provides access to keychain values related to the server communication configuration.
///
protocol ServerCommunicationConfigKeychainRepository { // sourcery: AutoMockable
    /// Attempts to delete the server communication config from the keychain.
    ///
    /// - Parameter hostname: The hostname associated with the server communication config.
    ///
    func deleteServerCommunicationConfig(hostname: String) async throws

    /// Gets the server communication configuration for a given hostname.
    ///
    /// - Parameter hostname: The hostname associated with the server communication config.
    /// - Returns: The server communication config for that hostname.
    ///
    func getServerCommunicationConfig(hostname: String) async throws -> VowkeySdk.ServerCommunicationConfig?

    /// Sets the server communication config for a given hostname.
    ///
    /// - Parameters:
    ///   - config: The server communication config.
    ///   - hostname: The hostname associated with the config.
    ///
    func setServerCommunicationConfig(_ config: VowkeySdk.ServerCommunicationConfig?, hostname: String) async throws
}

// MARK: Server Communication Config

extension DefaultKeychainRepository: ServerCommunicationConfigKeychainRepository {
    func deleteServerCommunicationConfig(hostname: String) async throws {
        try await keychainServiceFacade.deleteValue(
            for: VowkeyKeychainItem.serverCommunicationConfig(hostname: hostname),
        )
    }

    func getServerCommunicationConfig(hostname: String) async throws -> VowkeySdk.ServerCommunicationConfig? {
        do {
            return try await keychainServiceFacade.getValue(
                for: VowkeyKeychainItem.serverCommunicationConfig(hostname: hostname),
            )
        } catch KeychainServiceError.osStatusError(errSecItemNotFound), KeychainServiceError.keyNotFound {
            return nil
        }
    }

    func setServerCommunicationConfig(
        _ config: VowkeySdk.ServerCommunicationConfig?,
        hostname: String,
    ) async throws {
        guard let config else {
            try await deleteServerCommunicationConfig(hostname: hostname)
            return
        }
        try await keychainServiceFacade.setValue(
            config,
            for: VowkeyKeychainItem.serverCommunicationConfig(hostname: hostname),
        )
    }
}
