import VowkeyKit
import Foundation
import XCTest

@testable import VowkeyShared

class MockUserVerificationHelperDelegate: UserVerificationDelegate {
    var alertShown = [VowkeyKit.Alert]()
    var alertShownHandler: ((VowkeyKit.Alert) async throws -> Void)?
    var alertOnDismissed: (() -> Void)?

    func showAlert(_ alert: VowkeyKit.Alert) {
        alertShown.append(alert)
        Task {
            do {
                try await alertShownHandler?(alert)
            } catch {
                XCTFail("Error calling alert shown handler: \(error)")
            }
        }
    }

    func showAlert(_ alert: VowkeyKit.Alert, onDismissed: (() -> Void)?) {
        showAlert(alert)
        alertOnDismissed = onDismissed
    }
}
