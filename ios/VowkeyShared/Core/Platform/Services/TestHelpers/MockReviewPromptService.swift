import Combine
import Foundation

@testable import VowkeyShared

class MockReviewPromptService: ReviewPromptService {
    var isEligibleForReviewPromptResult: Bool = false
    var userActions: [VowkeyShared.UserAction] = []
    var setReviewPromptShownVersionCalled = false

    func isEligibleForReviewPrompt() async -> Bool {
        isEligibleForReviewPromptResult
    }

    func trackUserAction(_ action: VowkeyShared.UserAction) async {
        userActions.append(action)
    }

    func clearUserActions() async {
        userActions.removeAll()
    }

    func setReviewPromptShownVersion() async {
        setReviewPromptShownVersionCalled = true
    }
}
