@testable import VowkeyKit

public class MockErrorReporter: ErrorReporter {
    public var additionalLoggers = [any VowkeyLogger]()
    public var appContext: String?
    public var currentUserId: String?
    public var errors = [Error]()
    public var isEnabled = false
    public var region: (region: String, isPreAuth: Bool)?

    public init() {}

    public func add(logger: any VowkeyLogger) {
        additionalLoggers.append(logger)
    }

    public func log(error: Error) {
        errors.append(error)
    }

    public func setAppContext(_ appContext: String) {
        self.appContext = appContext
    }

    public func setRegion(_ region: String, isPreAuth: Bool) {
        self.region = (region, isPreAuth)
    }

    public func setUserId(_ userId: String?) {
        currentUserId = userId
    }
}
