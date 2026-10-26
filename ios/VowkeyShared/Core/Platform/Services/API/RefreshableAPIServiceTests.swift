import VowkeyKit
import VowkeyKitMocks
import TestHelpers
import XCTest

@testable import VowkeyShared
@testable import VowkeySharedMocks

// MARK: - RefreshableAPIServiceTests

class RefreshableAPIServiceTests: VowkeyTestCase {
    // MARK: Properties

    var accountTokenProvider: MockAccountTokenProvider!
    var subject: RefreshableAPIService!

    // MARK: Setup & Teardown

    override func setUp() {
        super.setUp()

        accountTokenProvider = MockAccountTokenProvider()
        subject = APIService(
            accountTokenProvider: accountTokenProvider,
            activeAccountStateProvider: MockStateService(),
            appIDService: AppIDService(appIDSettingsStore: MockAppIDSettingsStore()),
            environmentService: MockEnvironmentService(),
            errorReporter: MockErrorReporter(),
            flightRecorder: MockFlightRecorder(),
            serverCommunicationConfigClientSingleton: { MockServerCommunicationConfigClientSingleton() },
            stateService: MockStateService(),
            tokenService: MockTokenService(),
            userAgentBuilder: UserAgentBuilder(
                appName: "TestApp",
                appVersion: "1.0",
                systemDevice: MockSystemDevice(),
            ),
        )
    }

    override func tearDown() {
        super.tearDown()

        accountTokenProvider = nil
        subject = nil
    }

    // MARK: Tests

    /// `refreshAccessToken()` calls the token provider to refresh the token.
    @MainActor
    func test_refreshAccessToken() async throws {
        accountTokenProvider.refreshTokenReturnValue = "ACCESS_TOKEN"

        try await subject.refreshAccessToken()

        XCTAssertTrue(accountTokenProvider.refreshTokenCalled)
    }

    /// `refreshAccessToken()` throws when the token provider to refresh the token throws.
    @MainActor
    func test_refreshAccessToken_throws() async throws {
        accountTokenProvider.refreshTokenThrowableError = VowkeyTestError.example
        await assertAsyncThrows(error: VowkeyTestError.example) {
            try await subject.refreshAccessToken()
        }
    }
}
