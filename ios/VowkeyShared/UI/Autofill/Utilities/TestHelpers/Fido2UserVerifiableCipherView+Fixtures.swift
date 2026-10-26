// swiftlint:disable:this file_name

import VowkeySdk

@testable import VowkeyShared

struct MockFido2UserVerifiableCipherView: Fido2UserVerifiableCipherView {
    var reprompt: VowkeySdk.CipherRepromptType = .none
}
