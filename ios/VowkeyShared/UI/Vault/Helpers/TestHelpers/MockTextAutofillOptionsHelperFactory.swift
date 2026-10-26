import VowkeySdk

@testable import VowkeyShared

class MockTextAutofillOptionsHelperFactory: TextAutofillOptionsHelperFactory {
    var createResult: TextAutofillOptionsHelper?

    func create(cipherView: CipherView) -> TextAutofillOptionsHelper {
        createResult ?? MockTextAutofillOptionsHelper()
    }
}
