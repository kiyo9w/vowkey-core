import VowkeySdk

// MARK: - StubServerCommunicationConfigClientProtocol

/// A stub implementation of `ServerCommunicationConfigClientProtocol`.
public final class StubServerCommunicationConfigClientProtocol: ServerCommunicationConfigClientProtocol {
    public init() {}

    public func acquireCookie(domain: String) async throws {
        // no-op
    }

    public func cookies(domain: String) async -> [VowkeySdk.AcquiredCookie] {
        []
    }

    public func getConfig(domain: String) async throws -> VowkeySdk.ServerCommunicationConfig {
        ServerCommunicationConfig(bootstrap: .direct)
    }

    public func getCookies(domain: String) async throws -> [VowkeySdk.AcquiredCookie] {
        []
    }

    public func needsBootstrap(domain: String) async -> Bool {
        false
    }

    public func setCommunicationType(domain: String, request: VowkeySdk.SetCommunicationTypeRequest) async throws {
        // no-op
    }

    public func setCommunicationTypeV2(request: VowkeySdk.SetCommunicationTypeRequest) async throws {
        // no-op
    }
}
