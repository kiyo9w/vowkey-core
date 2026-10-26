import VowkeySdk
import Foundation

@testable import VowkeyShared

class MockFido2UserInterfaceHelperDelegate:
    MockFido2UserVerificationMediatorDelegate, Fido2UserInterfaceHelperDelegate {
    var isAutofillingFromList: Bool = false
    var informExcludedCredentialFoundCalledWith: CipherView?

    func informExcludedCredentialFound(cipherView: CipherView) async {
        informExcludedCredentialFoundCalledWith = cipherView
    }
}
