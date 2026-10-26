import VowkeySdk
import TestHelpers
import XCTest

@testable import VowkeyShared

// MARK: - ImportCiphersAPIServiceTests

@MainActor
class ImportCiphersAPIServiceTests: VowkeyTestCase {
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

    /// `importCiphers(encryptionContexts:folders:folderRelationships:)` performs the import ciphers request.
    func test_importCiphers() async throws {
        client.results = [
            .httpSuccess(testData: .emptyResponse),
        ]
        _ = try await subject.importCiphers(
            encryptionContexts: [EncryptionContext(encryptedFor: "user-1", cipher: .fixture())],
            folders: [],
            folderRelationships: [],
        )

        XCTAssertEqual(client.requests.count, 1)
        XCTAssertNotNil(client.requests[0].body)
        XCTAssertEqual(client.requests[0].method, .post)
        XCTAssertEqual(client.requests[0].url.absoluteString, "https://example.com/api/ciphers/import")
    }

    /// `importCiphers(encryptionContexts:folders:folderRelationships:)` throws on API failure.
    func test_importCiphers_throws() async throws {
        client.results = [
            .httpFailure(VowkeyTestError.example),
        ]

        await assertAsyncThrows(error: VowkeyTestError.example) {
            _ = try await subject.importCiphers(
                encryptionContexts: [EncryptionContext(encryptedFor: "user-1", cipher: .fixture())],
                folders: [],
                folderRelationships: [],
            )
        }
    }
}
