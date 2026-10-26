import VowkeySdk
import Combine
import Foundation
import TestHelpers

@testable import VowkeyShared

class MockFido2UserInterfaceHelper: Fido2UserInterfaceHelper {
    var checkUserCalled = false
    var checkUserResult: Result<VowkeySdk.CheckUserResult, Error> = .success(
        VowkeySdk.CheckUserResult(userPresent: true, userVerified: true),
    )
    var credentialsForAuthenticationSubject = CurrentValueSubject<[VowkeySdk.CipherView]?, Error>(
        nil,
    )
    var fido2CreationOptions: VowkeySdk.CheckUserOptions?
    var fido2CredentialNewView: VowkeySdk.Fido2CredentialNewView?
    var pickCredentialForAuthenticationResult: Result<VowkeySdk.CipherViewWrapper, Error> = .success(
        VowkeySdk.CipherViewWrapper(cipher: .fixture()),
    )
    var pickedCredentialForAuthenticationMocker = InvocationMocker<
        Result<CipherView, any Error>,
    >()
    var pickedCredentialForCreationMocker = InvocationMocker<
        Result<CheckUserAndPickCredentialForCreationResult, any Error>,
    >()
    var checkAndPickCredentialForCreationResult: Result<
        VowkeySdk.CheckUserAndPickCredentialForCreationResult,
        Error,
    > = .success(
        VowkeySdk.CheckUserAndPickCredentialForCreationResult(
            cipher: CipherViewWrapper(cipher: .fixture()),
            checkUserResult: CheckUserResult(userPresent: true, userVerified: true),
        ),
    )
    var isVerificationEnabledResult = false
    var fido2UserInterfaceHelperDelegate: Fido2UserInterfaceHelperDelegate?
    var userVerificationPreferenceSetup: Uv?

    nonisolated init() {}

    func availableCredentialsForAuthenticationPublisher() -> AnyPublisher<[VowkeySdk.CipherView]?, Error> {
        credentialsForAuthenticationSubject.eraseToAnyPublisher()
    }

    func checkUser(
        options: VowkeySdk.CheckUserOptions,
        hint: VowkeySdk.UiHint,
    ) async throws -> VowkeySdk.CheckUserResult {
        checkUserCalled = true
        return try checkUserResult.get()
    }

    func checkUser(
        userVerificationPreference: VowkeySdk.Verification,
        credential: Fido2UserVerifiableCipherView,
        shouldThrowEnforcingRequiredVerification: Bool,
    ) async throws -> VowkeySdk.CheckUserResult {
        checkUserCalled = true
        return try checkUserResult.get()
    }

    func pickCredentialForAuthentication(
        availableCredentials: [VowkeySdk.CipherView],
    ) async throws -> VowkeySdk.CipherViewWrapper {
        try pickCredentialForAuthenticationResult.get()
    }

    func pickedCredentialForAuthentication(result: Result<CipherView, any Error>) {
        pickedCredentialForAuthenticationMocker.invoke(param: result)
    }

    func pickedCredentialForCreation(
        result: Result<VowkeySdk.CheckUserAndPickCredentialForCreationResult, any Error>,
    ) {
        pickedCredentialForCreationMocker.invoke(param: result)
    }

    func checkUserAndPickCredentialForCreation(
        options: VowkeySdk.CheckUserOptions,
        newCredential: VowkeySdk.Fido2CredentialNewView,
    ) async throws -> VowkeySdk.CheckUserAndPickCredentialForCreationResult {
        try checkAndPickCredentialForCreationResult.get()
    }

    func isVerificationEnabled() -> Bool {
        isVerificationEnabledResult
    }

    func setupDelegate(fido2UserInterfaceHelperDelegate: any VowkeyShared.Fido2UserInterfaceHelperDelegate) {
        self.fido2UserInterfaceHelperDelegate = fido2UserInterfaceHelperDelegate
    }

    func setupCurrentUserVerificationPreference(userVerificationPreference: VowkeySdk.Uv) {
        userVerificationPreferenceSetup = userVerificationPreference
    }
}
