import Combine
import Foundation

@testable import VowkeyShared

class MockUserVerificationRunner: UserVerificationRunner {
    var onVerifyInQueueFunctionCalled: (Int) -> Void = { _ in
    }

    var onverifyWithAttemptsFunctionCalled: (Int) -> Void = { _ in
    }

    var verifyInQueueCalled = false
    var verifyInQueueResult: Result<UserVerificationResult, Error> = .success(.verified)
    var verifyWithAttemptsTimesCalled: Int = 0

    func verifyWithAttempts(
        verifyFunction: () async throws -> VowkeyShared.UserVerificationResult,
    ) async throws -> VowkeyShared.UserVerificationResult {
        verifyWithAttemptsTimesCalled += 1

        let result = try await verifyFunction()
        onverifyWithAttemptsFunctionCalled(verifyWithAttemptsTimesCalled)

        return result
    }

    func verifyInQueue(
        verifyFunctions: [() async throws -> VowkeyShared.UserVerificationResult],
    ) async throws -> VowkeyShared.UserVerificationResult {
        for (index, verifyFunction) in verifyFunctions.enumerated() {
            _ = try await verifyFunction()
            onVerifyInQueueFunctionCalled(index)
        }

        verifyInQueueCalled = true
        return try verifyInQueueResult.get()
    }
}
