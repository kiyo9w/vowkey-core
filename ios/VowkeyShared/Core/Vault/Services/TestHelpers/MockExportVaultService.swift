import AuthenticationServices
import VowkeySdk
import Foundation
import TestHelpers
import XCTest

@testable import VowkeyShared

class MockExportVaultService: ExportVaultService {
    var didClearFiles = false
    var exportVaultContentsFormat: ExportFileType?
    var exportVaultContentsIncludeArchived: Bool?
    var exportVaultContentResult: Result<String, Error> = .failure(VowkeyTestError.example)
    var fetchAllCiphersToExportIncludeArchived: Bool?
    var fetchAllCiphersToExportResult: Result<[VowkeySdk.Cipher], Error> = .success([])
    var mockFileName: String = "mockExport.json"
    var writeToFileResult: Result<URL, Error> = .failure(VowkeyTestError.example)

    func clearTemporaryFiles() {
        didClearFiles = true
    }

    func exportVaultFileContents(
        format: VowkeyShared.ExportFileType,
        includeArchivedItems: Bool,
    ) async throws -> String {
        exportVaultContentsFormat = format
        exportVaultContentsIncludeArchived = includeArchivedItems
        return try exportVaultContentResult.get()
    }

    func fetchAllCiphersToExport(includeArchivedItems: Bool) async throws -> [VowkeySdk.Cipher] {
        fetchAllCiphersToExportIncludeArchived = includeArchivedItems
        return try fetchAllCiphersToExportResult.get()
    }

    func generateExportFileName(
        prefix: String?,
        extension fileExtension: String,
    ) -> String {
        mockFileName
    }

    func writeToFile(name fileName: String, content fileContent: String) throws -> URL {
        try writeToFileResult.get()
    }
}
