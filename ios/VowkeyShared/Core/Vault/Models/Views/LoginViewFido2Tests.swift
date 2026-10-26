import VowkeySdk
import XCTest

@testable import VowkeyShared

class LoginViewFido2Tests: VowkeyTestCase {
    // MARK: Tests

    /// `hasFido2Credentials` with Fido2 credentials nil.
    func test_hasFido2Credentials_nilFido2Credentials() {
        let subject = LoginView.fixture()
        XCTAssertFalse(subject.hasFido2Credentials)
    }

    /// `hasFido2Credentials` with empty Fido2 credentials.
    func test_hasFido2Credentials_emptyFido2Credentials() {
        let subject = LoginView.fixture(fido2Credentials: [])
        XCTAssertFalse(subject.hasFido2Credentials)
    }

    /// `hasFido2Credentials` with Fido2 credentials.
    func test_hasFido2Credentials_withFido2Credentials() {
        let subject = LoginView.fixture(fido2Credentials: [Fido2CredentialView.fixture()])
        XCTAssertTrue(subject.hasFido2Credentials)
    }
}
