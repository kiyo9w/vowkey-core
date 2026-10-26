import InlineSnapshotTesting
import XCTest

@testable import VowkeyShared

class SaveAttachmentRequestTests: VowkeyTestCase {
    // MARK: Properties

    var subject: SaveAttachmentRequest!

    // MARK: Set Up & Tear Down

    override func setUp() {
        super.setUp()
        subject = SaveAttachmentRequest(cipherId: "1", fileName: "Name", fileSize: 10, key: "🔑")
    }

    override func tearDown() {
        super.tearDown()
        subject = nil
    }

    // MARK: Tests

    /// `body` returns the expected result.
    func test_body() throws {
        assertInlineSnapshot(of: subject.body as SaveAttachmentRequestModel?, as: .json) {
            """
            {
              "fileName" : "Name",
              "fileSize" : 10,
              "key" : "🔑"
            }
            """
        }
    }

    /// `method` returns the method of the request.
    func test_method() throws {
        XCTAssertEqual(subject.method, .post)
    }

    /// `path` returns the path of the request.
    func test_path() throws {
        XCTAssertEqual(subject.path, "/ciphers/1/attachment/v2")
    }
}
