import Combine
import Foundation

@testable import VowkeyShared

class MockUserVerificationHelper: UserVerificationHelper {
    var userVerificationDelegate: (any VowkeyShared.UserVerificationDelegate)?

    var canVerifyDeviceLocalAuthResult: Bool = false
    var setupPinCalled = false
    var verifyDeviceLocalAuthBecauseValue: String?
    var verifyDeviceLocalAuthCalled: Bool = false
    var verifyDeviceLocalAuthResult: Result<VowkeyShared.UserVerificationResult, Error> = .success(.verified)
    var verifyMasterPasswordCalled: Bool = false
    var verifyMasterPasswordResult: Result<VowkeyShared.UserVerificationResult, Error> = .success(.verified)
    var verifyPinCalled: Bool = false
    var verifyPinResult: Result<VowkeyShared.UserVerificationResult, Error> = .success(.verified)

    func canVerifyDeviceLocalAuth() -> Bool {
        canVerifyDeviceLocalAuthResult
    }

    func setupPin() async throws {
        setupPinCalled = true
    }

    func verifyDeviceLocalAuth(reason: String) async throws -> UserVerificationResult {
        verifyDeviceLocalAuthCalled = true
        verifyDeviceLocalAuthBecauseValue = reason
        return try verifyDeviceLocalAuthResult.get()
    }

    func verifyMasterPassword() async throws -> VowkeyShared.UserVerificationResult {
        verifyMasterPasswordCalled = true
        return try verifyMasterPasswordResult.get()
    }

    func verifyPin() async throws -> VowkeyShared.UserVerificationResult {
        verifyPinCalled = true
        return try verifyPinResult.get()
    }
}
