import VowkeySdk

@testable import VowkeyShared

class MockTextAutofillHelperFactory: TextAutofillHelperFactory {
    var createResult: TextAutofillHelper?

    func create(delegate: TextAutofillHelperDelegate) -> TextAutofillHelper {
        createResult ?? NoOpTextAutofillHelper()
    }
}
