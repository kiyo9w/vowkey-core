import AuthenticationServices
import VowkeySdk
import TestHelpers

@testable import VowkeyShared

class MockCredentialIdentityFactory: CredentialIdentityFactory {
    var createCredentialIdentitiesMocker = InvocationMockerWithThrowingResult<CipherView, [CredentialIdentity]>()
        .throwing(VowkeyTestError.example)
    // swiftlint:disable:next identifier_name
    var tryCreatePasswordCredentialIdentityResult: ASPasswordCredentialIdentity?

    @available(iOS 17.0, *)
    func createCredentialIdentities(
        from cipher: VowkeySdk.CipherView,
        accountHasPremium: Bool,
    ) async -> [any ASCredentialIdentity] {
        do {
            return try createCredentialIdentitiesMocker.invoke(param: cipher)
                .compactMap(\.asCredentialIdentity)
        } catch {
            return []
        }
    }

    func tryCreatePasswordCredentialIdentity(from cipher: VowkeySdk.CipherView) -> ASPasswordCredentialIdentity? {
        tryCreatePasswordCredentialIdentityResult
    }
}
