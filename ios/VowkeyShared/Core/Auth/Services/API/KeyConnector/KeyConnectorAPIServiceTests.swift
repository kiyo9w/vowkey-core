import TestHelpers
import XCTest

@testable import VowkeyShared

@MainActor
class KeyConnectorAPIServiceTests: VowkeyTestCase {
    // MARK: Properties

    var client: MockHTTPClient!
    var subject: APIService!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()
        client = MockHTTPClient()
        subject = APIService(client: client)
    }

    override func tearDown() async throws {
        try await super.tearDown()
        client = nil
        subject = nil
    }

    // MARK: Tests

    /// `postMasterKeyToKeyConnector(keyConnectorUrl:)` sends the user's key to the API.
    func test_postMasterKeyToKeyConnector() async throws {
        client.result = .httpSuccess(testData: .emptyResponse)

        await assertAsyncDoesNotThrow {
            try await subject.postMasterKeyToKeyConnector(
                key: "🔑",
                keyConnectorUrl: URL(string: "https://example.com")!,
            )
        }

        let request = try XCTUnwrap(client.requests.first)
        XCTAssertEqual(request.method, .post)
        XCTAssertEqual(request.url.relativePath, "/user-keys")
        XCTAssertNotNil(request.body)
    }

    /// `postMasterKeyToKeyConnector(keyConnectorUrl:)` throws an error if the request fails.
    func test_postMasterKeyToKeyConnector_httpFailure() async throws {
        client.result = .httpFailure(VowkeyTestError.example)

        await assertAsyncThrows(error: VowkeyTestError.example) {
            _ = try await subject.postMasterKeyToKeyConnector(
                key: "🔑",
                keyConnectorUrl: URL(string: "https://example.com")!,
            )
        }
    }
}
