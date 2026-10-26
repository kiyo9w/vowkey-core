import VowkeyResources
import XCTest

@testable import VowkeyShared

// MARK: - PasswordAutoFillStateTests

class PasswordAutoFillStateTests: VowkeyTestCase {
    // MARK: Tests

    /// `navigationBarTitle` returns the account setup title when in onboarding mode.
    func test_navigationBarTitle_onboarding() {
        let subject = PasswordAutoFillState(mode: .onboarding)
        XCTAssertEqual(subject.navigationBarTitle, Localizations.accountSetup)
    }

    /// `navigationBarTitle` returns the password autofill title when in settings mode.
    func test_navigationBarTitle_settings() {
        let subject = PasswordAutoFillState(mode: .settings)
        XCTAssertEqual(subject.navigationBarTitle, Localizations.passwordAutofill)
    }

    /// `title` returns the iOS 18+ title on supported devices.
    func test_title_iOS18Plus() {
        guard #available(iOS 18, *) else { return }
        let subject = PasswordAutoFillState(mode: .onboarding)
        XCTAssertEqual(subject.title, Localizations.autofillWithVowkey)
    }

    /// `title` returns the pre-iOS 18 title on older devices.
    func test_title_preIOS18() {
        guard #unavailable(iOS 18) else { return }
        let subject = PasswordAutoFillState(mode: .onboarding)
        XCTAssertEqual(subject.title, Localizations.turnOnAutoFill)
    }

    /// `subtitle` returns the iOS 18+ subtitle on supported devices.
    func test_subtitle_iOS18Plus() {
        guard #available(iOS 18, *) else { return }
        let subject = PasswordAutoFillState(mode: .onboarding)
        XCTAssertEqual(subject.subtitle, Localizations.autofillWithVowkeyDescriptionLong)
    }

    /// `subtitle` returns the pre-iOS 18 subtitle on older devices.
    func test_subtitle_preIOS18() {
        guard #unavailable(iOS 18) else { return }
        let subject = PasswordAutoFillState(mode: .onboarding)
        XCTAssertEqual(subject.subtitle, Localizations.useAutoFillToLogIntoYourAccountsWithASingleTap)
    }
}
