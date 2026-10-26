import Foundation

@testable import VowkeyShared

class MockMasterPasswordUpdateDelegate: MasterPasswordUpdateDelegate {
    var updatedPassword: String = ""
    var updateMasterPasswordCalled = false

    func didUpdateMasterPassword(password: String) {
        updatedPassword = password
        updateMasterPasswordCalled = true
    }
}
