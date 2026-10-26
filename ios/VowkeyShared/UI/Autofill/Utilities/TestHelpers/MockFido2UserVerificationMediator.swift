import VowkeySdk
import Foundation

@testable import VowkeyShared

class MockFido2UserVerificationMediator: Fido2UserVerificationMediator {
    var checkUserResult: Result<VowkeySdk.CheckUserResult, Error> = .success(
        CheckUserResult(
            userPresent: false,
            userVerified: false,
        ),
    )
    var isPreferredVerificationEnabledResult = false
    var setupDelegateCalled = false

    func checkUser(
        userVerificationPreference: VowkeySdk.Verification,
        credential: Fido2UserVerifiableCipherView,
    ) async throws -> VowkeySdk.CheckUserResult {
        try checkUserResult.get()
    }

    func isPreferredVerificationEnabled() -> Bool {
        isPreferredVerificationEnabledResult
    }

    func setupDelegate(
        fido2UserVerificationMediatorDelegate: any VowkeyShared.Fido2UserVerificationMediatorDelegate,
    ) {
        setupDelegateCalled = true
    }
}
