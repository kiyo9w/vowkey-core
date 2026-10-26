import VowkeySdk

@testable import VowkeyShared

// MARK: - MockSendItemDelegate

class MockSendItemDelegate: SendItemDelegate {
    var didSendItemCancelled = false

    var didSendItemCompleted = false
    var sendItemCompletedSendView: SendView?

    var didSendItemDeleted = false

    var handledAuthActions = [AuthAction]()

    func handle(_ authAction: VowkeyShared.AuthAction) async {
        handledAuthActions.append(authAction)
    }

    func sendItemCancelled() {
        didSendItemCancelled = true
    }

    func sendItemCompleted(with sendView: SendView) {
        didSendItemCompleted = true
        sendItemCompletedSendView = sendView
    }

    func sendItemDeleted() {
        didSendItemDeleted = true
    }
}
