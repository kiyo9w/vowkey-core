import XCTest

@testable import VowkeyShared

// MARK: - DirectSendFileUploadRequestTests

class DirectSendFileUploadRequestTests: VowkeyTestCase {
    // MARK: Tests

    /// `init(data:fileName:fileId:sendId:)` initializes the properties correctly.
    func test_init() {
        let data = Data("example".utf8)
        let subject = DirectSendFileUploadRequest(
            data: data,
            fileName: "file_name",
            fileId: "file_id",
            sendId: "send_id",
        )

        XCTAssertEqual(subject.fileId, "file_id")
        XCTAssertEqual(subject.sendId, "send_id")
    }
}
