import XCTest

@testable import VowkeyShared

// MARK: - DirectFileUploadRequestModelTests

class DirectFileUploadRequestModelTests: VowkeyTestCase {
    // MARK: Tests

    /// `init(data:date:fileName:)` initializes all the values correctly.
    func test_init() {
        let data = Data("example".utf8)
        let date = Date(timeIntervalSince1970: 420_420)
        let fileName = "example.txt"
        let subject = DirectFileUploadRequestModel(
            data: data,
            date: date,
            fileName: fileName,
        )

        XCTAssertEqual(
            subject.parts,
            [
                .file(
                    data: data,
                    name: "data",
                    fileName: fileName,
                ),
            ],
        )
        XCTAssertEqual(subject.boundary, "--BWMobileFormBoundary420420000.0")
    }
}
