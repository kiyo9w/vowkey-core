// swiftlint:disable:this file_name

import VowkeySdk

/// Extensions for the `VowkeySdk.LoginView`
extension VowkeySdk.LoginView {
    /// Whether the login has Fido2 credentials or not
    var hasFido2Credentials: Bool {
        guard let fido2Credentials else {
            return false
        }

        return !fido2Credentials.isEmpty
    }
}
