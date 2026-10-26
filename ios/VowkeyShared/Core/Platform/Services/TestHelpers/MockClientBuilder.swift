import VowkeyKit
import VowkeyKitMocks
import VowkeySdk
import VowkeySdkMocks

@testable import VowkeyShared

final class MockClientBuilder: ClientBuilder {
    var clients = [MockClient]()
    var setupClientOnCreation: ((MockClient) -> Void)?

    func buildClient() async -> VowkeySdkClient {
        let client = MockClient()
        if let setupClientOnCreation {
            setupClientOnCreation(client)
        }
        clients.append(client)
        return client
    }
}

class MockClient: VowkeySdkClient {
    var authClient = MockAuthClientService()
    var cryptoClient = MockCryptoClientProtocol()
    var exporterClient = MockExporterClientProtocol()
    var generatorClient = MockGeneratorClientsProtocol()
    var kmStateBridgeClient = MockStateBridgeClientProtocol()
    var platformClient = MockPlatformClientService.withMocks()
    var policiesClient = MockPoliciesClientProtocol()
    var sendClient = MockSendClientProtocol()
    var userCryptoManagementClient = MockUserCryptoManagementClientService.withMocks()
    var vaultClient = MockVaultClientService()

    func auth() -> any AuthClientService {
        authClient
    }

    func crypto() -> CryptoClientProtocol {
        cryptoClient
    }

    func echo(msg: String) -> String {
        ""
    }

    func exporters() -> any ExporterClientProtocol {
        exporterClient
    }

    func generators() -> any GeneratorClientsProtocol {
        generatorClient
    }

    func kmStateBridge() -> any StateBridgeClientProtocol {
        kmStateBridgeClient
    }

    func platform() -> any PlatformClientService {
        platformClient
    }

    func policies() -> any PoliciesClientProtocol {
        policiesClient
    }

    func sends() -> any SendClientProtocol {
        sendClient
    }

    func userCryptoManagement() -> any UserCryptoManagementClientService {
        userCryptoManagementClient
    }

    func vault() -> any VaultClientService {
        vaultClient
    }
}
