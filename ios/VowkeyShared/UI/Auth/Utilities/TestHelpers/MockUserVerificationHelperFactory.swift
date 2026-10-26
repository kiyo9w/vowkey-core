@testable import VowkeyShared

class MockUserVerificationHelperFactory: UserVerificationHelperFactory {
    var createCalled = false
    var createResult: UserVerificationHelper?

    func create() -> UserVerificationHelper {
        createCalled = true
        return createResult ?? MockUserVerificationHelper()
    }
}
