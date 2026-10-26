import Testing

@testable import VowkeyShared

// MARK: - AppContextTests

class AppContextTests {
    // MARK: Tests

    /// `description` returns the expected string for each `AppContext` case.
    @Test
    func description() {
        #expect(String(describing: AppContext.appExtension) == "App Extension")
        #expect(String(describing: AppContext.mainApp) == "Main App")
    }
}
