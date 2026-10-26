import AuthenticatorBridgeKit
@testable import VowkeyShared

class MockAuthenticatorSyncService: AuthenticatorSyncService {
    var tempItem: AuthenticatorBridgeItemDataView?

    func getTemporaryTotpItem() async -> AuthenticatorBridgeItemDataView? {
        tempItem
    }

    func start() {}
}
