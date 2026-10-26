import VowkeyKit
import VowkeySdk

@testable import VowkeyShared

class MockTOTPService: TOTPService {
    var capturedKey: String?
    var copyTotpIfPossibleCalled = false
    var copyTotpIfPossibleError: Error?
    var getTOTPConfigResult: Result<TOTPKeyModel, Error> = .failure(TOTPKeyError.invalidKeyFormat)
    var isTotpAuthorizedResult = true

    func copyTotpIfPossible(cipher: VowkeySdk.CipherView) async throws {
        copyTotpIfPossibleCalled = true
        if let copyTotpIfPossibleError {
            throw copyTotpIfPossibleError
        }
    }

    func getTOTPConfiguration(key: String?) throws -> VowkeyShared.TOTPKeyModel {
        capturedKey = key
        return try getTOTPConfigResult.get()
    }

    func isTotpAuthorized(for cipher: any CipherWithOrgTOTPStatus) async -> Bool {
        isTotpAuthorizedResult
    }
}
