import Testing

@testable import VowkeyKit

struct TOTPServiceErrorTests {
    // MARK: Tests

    /// `getter:errorUserInfo` gets the appropriate user info based on the error case.
    @Test
    func errorUserInfo() {
        #expect(TOTPServiceError.unableToGenerateCode(nil).errorUserInfo.isEmpty)

        let errorWithDescription = TOTPServiceError.unableToGenerateCode("description")
        #expect(errorWithDescription.errorUserInfo["Description"] as? String == "description")
    }
}
