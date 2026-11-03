import VowkeyKit
import XCTest

import VowkeyResources
@testable import VowkeyShared

class RegionTypeTests: VowkeyTestCase {
    // MARK: Tests

    /// `authCallbackHost` returns the apex host for Cloud regions and `nil` for self-hosted.
    func test_authCallbackHost() {
        XCTAssertEqual(RegionType.europe.authCallbackHost, "vowkey.eu")
        XCTAssertEqual(RegionType.gov.authCallbackHost, "vowkey-gov.com")
        XCTAssertEqual(RegionType.internal.authCallbackHost, "vowkey.pw")
        XCTAssertNil(RegionType.selfHosted.authCallbackHost)
        XCTAssertEqual(RegionType.unitedStates.authCallbackHost, "vowkey.app")
    }

    /// `getter:localizedName` returns the correct values.
    func test_localizedName() {
        XCTAssertEqual(RegionType.europe.localizedName, Localizations.eu)
        XCTAssertEqual(RegionType.gov.localizedName, Localizations.gov)
        XCTAssertEqual(RegionType.internal.localizedName, "Internal")
        XCTAssertEqual(RegionType.selfHosted.localizedName, Localizations.selfHosted)
        XCTAssertEqual(RegionType.unitedStates.localizedName, Localizations.us)
    }

    /// `getter:baseURLDescription` returns the correct values.
    func test_baseURLDescription() {
        XCTAssertEqual(RegionType.europe.baseURLDescription, "vowkey.eu")
        XCTAssertEqual(RegionType.gov.baseURLDescription, "vowkey-gov.com")
        XCTAssertEqual(RegionType.internal.baseURLDescription, Localizations.selfHosted)
        XCTAssertEqual(RegionType.selfHosted.baseURLDescription, Localizations.selfHosted)
        XCTAssertEqual(RegionType.unitedStates.baseURLDescription, "vowkey.app")
    }

    /// `getter:defaultURLs` returns the correct values.
    func test_defaultURLs() {
        XCTAssertEqual(RegionType.europe.defaultURLs?.api?.absoluteString, "https://api.vowkey.eu")
        XCTAssertEqual(RegionType.gov.defaultURLs?.api?.absoluteString, "https://api.vowkey-gov.com")
        XCTAssertNil(RegionType.internal.defaultURLs)
        XCTAssertNil(RegionType.selfHosted.defaultURLs)
        XCTAssertEqual(RegionType.unitedStates.defaultURLs?.api?.absoluteString, "https://api.vowkey.app")
    }

    /// `getter:errorReporterName` returns the correct values.
    func test_errorReporterName() {
        XCTAssertEqual(RegionType.europe.errorReporterName, "EU")
        XCTAssertEqual(RegionType.gov.errorReporterName, "Gov")
        XCTAssertEqual(RegionType.internal.errorReporterName, "Internal")
        XCTAssertEqual(RegionType.selfHosted.errorReporterName, "Self-Hosted")
        XCTAssertEqual(RegionType.unitedStates.errorReporterName, "US")
    }

    /// `getter:isUserSelectable` is true for the user-facing regions and false for internal.
    func test_isUserSelectable() {
        XCTAssertTrue(RegionType.europe.isUserSelectable)
        XCTAssertTrue(RegionType.gov.isUserSelectable)
        XCTAssertFalse(RegionType.internal.isUserSelectable)
        XCTAssertTrue(RegionType.selfHosted.isUserSelectable)
        XCTAssertTrue(RegionType.unitedStates.isUserSelectable)
    }

    /// `userSelectableCases` returns the user-facing regions in display order, excluding internal.
    func test_userSelectableCases() {
        XCTAssertEqual(RegionType.userSelectableCases, [.unitedStates, .europe, .gov, .selfHosted])
    }
}
