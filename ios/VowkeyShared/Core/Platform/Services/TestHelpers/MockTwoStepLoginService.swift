import Foundation

@testable import VowkeyShared

class MockTwoStepLoginService: TwoStepLoginService {
    func twoStepLoginUrl() -> URL {
        URL.example
    }
}
