import Networking
import XCTest

@testable import VowkeyShared

class PostKeyConnectorUserKeyRequestTests: VowkeyTestCase {
    // MARK: Properties

    let subject = PostKeyConnectorUserKeyRequest(body: PostKeyConnectorUserKeyRequestModel(key: "🔑"))

    // MARK: Tests

    /// `body` is the JSON encoded request model.
    func test_body() throws {
        let bodyData = try XCTUnwrap(subject.body?.encode())
        XCTAssertEqual(
            bodyData.prettyPrintedJson,
            """
            {
              "key" : "🔑"
            }
            """,
        )
    }

    /// Validate that the method is correct.
    func test_method() {
        XCTAssertEqual(subject.method, .post)
    }

    /// Validate that the path is correct.
    func test_path() {
        XCTAssertEqual(subject.path, "/user-keys")
    }
}
