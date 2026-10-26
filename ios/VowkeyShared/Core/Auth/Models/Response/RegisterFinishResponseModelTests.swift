import TestHelpers
import XCTest

@testable import VowkeyShared

// MARK: - RegisterFinishResponseModelTests

class RegisterFinishResponseModelTests: VowkeyTestCase {
    /// Tests the successful decoding of a JSON response.
    func test_decode_success() throws {
        let json = APITestData.registerFinishSuccess.data
        let decoder = JSONDecoder()
        XCTAssertNoThrow(try decoder.decode(RegisterFinishResponseModel.self, from: json))
    }
}
