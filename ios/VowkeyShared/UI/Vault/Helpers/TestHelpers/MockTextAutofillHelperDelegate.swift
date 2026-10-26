import VowkeyKit
@testable import VowkeyShared

class MockTextAutofillHelperDelegate: TextAutofillHelperDelegate {
    var alertsShown = [VowkeyKit.Alert]()
    var alertOnDismissed: (() -> Void)?
    var completeTextRequestText: String?

    func completeTextRequest(text: String) {
        completeTextRequestText = text
    }

    func showAlert(_ alert: VowkeyKit.Alert, onDismissed: (() -> Void)?) {
        alertsShown.append(alert)
        alertOnDismissed = onDismissed
    }
}
