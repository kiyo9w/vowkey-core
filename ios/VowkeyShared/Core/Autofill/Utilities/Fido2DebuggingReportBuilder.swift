#if DEBUG

import VowkeySdk
import Foundation

/// Report with traceability about Fido2 flows.
public struct Fido2DebuggingReport {
    var allCredentialsResult: Result<[VowkeySdk.CipherListView], Error>?
    var findCredentialsResult: Result<[VowkeySdk.CipherView], Error>?
    var getAssertionRequest: GetAssertionRequest?
    var getAssertionResult: Result<GetAssertionResult, Error>?
    var saveCredentialCipher: Result<VowkeySdk.Cipher, Error>?
}

/// Fido2 builder for debugging report.
public struct Fido2DebuggingReportBuilder {
    /// Builder for Fido2 debugging report.
    public static var builder = Fido2DebuggingReportBuilder()

    var report = Fido2DebuggingReport()

    /// Gets the report for Fido2 debugging.
    /// - Returns: Fido2 report.
    public func getReport() -> Fido2DebuggingReport? {
        report
    }

    mutating func withAllCredentialsResult(_ result: Result<[VowkeySdk.CipherListView], Error>) {
        report.allCredentialsResult = result
    }

    mutating func withFindCredentialsResult(_ result: Result<[VowkeySdk.CipherView], Error>) {
        report.findCredentialsResult = result
    }

    mutating func withGetAssertionRequest(_ request: GetAssertionRequest) {
        report.getAssertionRequest = request
    }

    mutating func withGetAssertionResult(_ result: Result<GetAssertionResult, Error>) {
        report.getAssertionResult = result
    }

    mutating func withSaveCredentialCipher(_ credential: Result<VowkeySdk.Cipher, Error>) {
        report.saveCredentialCipher = credential
    }
}

#endif
