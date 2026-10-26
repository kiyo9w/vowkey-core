import AppIntents
import VowkeyShared

/// App intent that opens the generator view.
@available(iOS 16.4, *)
struct OpenGeneratorIntent: ForegroundContinuableIntent {
    static var title: LocalizedStringResource = "OpenGenerator"

    static var description = IntentDescription("OpenGenerator")

    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        let services = ServiceContainer.shared(
            errorReporter: { ErrorReporterFactory.makeDefaultErrorReporter() },
        )
        let appIntentMediator = services.getAppIntentMediator()

        guard try await appIntentMediator.canRunAppIntents() else {
            throw VowkeyShared.AppIntentError.notAllowed
        }

        try await requestToContinueInForeground {
            await appIntentMediator.openGenerator()
        }

        return .result()
    }
}
