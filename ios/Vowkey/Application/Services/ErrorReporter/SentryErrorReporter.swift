import VowkeyKit
import VowkeyShared
import Sentry

/// Reports crashes through the Sentry SDK only after the person turns the switch on
/// and `/api/config` supplies an iOS DSN. Off, the SDK is not started.
final class SentryErrorReporter: ErrorReporter {
    static let shared = SentryErrorReporter()

    private var additionalLoggers: [any VowkeyLogger] = []
    private let defaults: UserDefaults
    private var startedDsn: String?

    var isEnabled: Bool {
        get { defaults.bool(forKey: Self.consentKey) }
        set {
            defaults.set(newValue, forKey: Self.consentKey)
            if newValue {
                startIfNeeded()
            } else {
                stop()
            }
        }
    }

    private init(defaults: UserDefaults = UserDefaults(suiteName: Bundle.main.groupIdentifier) ?? .standard) {
        self.defaults = defaults
    }

    func add(logger: any VowkeyLogger) {
        additionalLoggers.append(logger)
    }

    func log(error: Error) {
        let callStack = Thread.callStackSymbols.joined(separator: "\n")
        for logger in additionalLoggers {
            logger.log("Error: \(error)\n\(callStack)")
        }
        guard isEnabled, !error.isNonLoggableError else { return }
        startIfNeeded()
        guard startedDsn != nil else { return }
        SentrySDK.capture(error: error)
    }

    /// App context, region and account id stay on the device.
    func setAppContext(_: String) {}
    func setRegion(_: String, isPreAuth _: Bool) {}
    func setUserId(_: String?) {}

    private func startIfNeeded() {
        let dsn = defaults.string(forKey: Self.dsnKey) ?? ""
        guard isEnabled, !dsn.isEmpty, startedDsn != dsn else { return }
        if startedDsn != nil {
            SentrySDK.close()
        }
        SentrySDK.start { options in
            options.dsn = dsn
            options.sendDefaultPii = false
            options.maxBreadcrumbs = 0
            options.enableNetworkBreadcrumbs = false
            options.enableAutoSessionTracking = false
            options.enableWatchdogTerminationTracking = false
            options.enableSwizzling = false
            options.enableCrashHandler = true
            options.attachStacktrace = true
            options.beforeSend = { event in
                Self.reduce(event)
            }
        }
        startedDsn = dsn
    }

    private func stop() {
        guard startedDsn != nil else { return }
        SentrySDK.close()
        startedDsn = nil
    }

    /// Exception messages can contain decrypted values; retain their class and stack instead.
    static func reduce(_ event: Event) -> Event? {
        guard event.exceptions != nil || event.stacktrace != nil || event.threads != nil else { return nil }
        let message = errorClass(event.exceptions?.first?.type)
        let kept = event.context?["os"]
        event.message = SentryMessage(formatted: message)
        event.error = nil
        event.breadcrumbs = nil
        event.request = nil
        event.user = nil
        event.extra = nil
        event.tags = nil
        event.context = kept.map { ["os": $0] }
        event.fingerprint = nil
        event.modules = nil
        event.debugMeta = nil
        event.transaction = nil
        event.serverName = nil
        event.environment = nil
        event.logger = nil
        event.type = nil
        event.sdk = nil
        for exception in event.exceptions ?? [] {
            exception.type = errorClass(exception.type)
            exception.value = exception.type
            exception.mechanism = nil
            Self.scrub(exception.stacktrace)
        }
        for thread in event.threads ?? [] {
            thread.name = nil
            Self.scrub(thread.stacktrace)
        }
        Self.scrub(event.stacktrace)
        return event
    }

    private static func errorClass(_ value: String?) -> String {
        switch value {
        case "NSError", "NSException", "NSInvalidArgumentException", "NSRangeException",
             "EXC_BAD_ACCESS", "EXC_CRASH", "EXC_BREAKPOINT", "EXC_BAD_INSTRUCTION",
             "EXC_ARITHMETIC", "SIGABRT", "SIGSEGV":
            return value ?? "Error"
        default:
            return "Error"
        }
    }

    private static func scrub(_ stack: SentryStacktrace?) {
        guard let stack else { return }
        stack.registers = [:]
        for frame in stack.frames {
            frame.fileName = nil
            frame.package = nil
            frame.module = nil
            frame.contextLine = nil
            frame.preContext = nil
            frame.postContext = nil
            frame.vars = nil
            frame.function = frame.function.map(Self.scrub)
        }
    }

    /// Drops a URL or a path. A symbol name has neither.
    private static func scrub(_ value: String) -> String {
        value.replacingOccurrences(of: #"https?://\S+"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"(?:/[\w.~+-]+)+"#, with: "", options: .regularExpression)
    }

    private static let consentKey = "sendCrashReports"
    private static let dsnKey = "crashDsn.ios"
}
