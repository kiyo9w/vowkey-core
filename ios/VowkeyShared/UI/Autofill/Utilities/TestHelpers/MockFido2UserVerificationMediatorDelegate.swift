import VowkeySdk

@testable import VowkeyShared

class MockFido2UserVerificationMediatorDelegate:
    MockUserVerificationHelperDelegate,
    Fido2UserVerificationMediatorDelegate {
    var onNeedsUserInteractionCalled = false
    var onNeedsUserInteractionError: Error?

    func onNeedsUserInteraction() async throws {
        onNeedsUserInteractionCalled = true
        if let onNeedsUserInteractionError {
            throw onNeedsUserInteractionError
        }
    }
}
