import VowkeyKit

public class MockBundle: BundleProtocol {
    public var appExtensionIdentifier = "com.vowkey.app.find-login-action-extension"
    public var appIdentifier = "com.vowkey.app"
    public var appName = "Vowkey"
    public var appVersion = "1.0"
    public var bundleIdentifier: String? = "com.vowkey.app"
    public var buildNumber = "1"
    public var groupIdentifier = "group.com.vowkey.app"
    public var keychainAccessGroup = "group.com.vowkey.app"
    public var sharedAppGroupIdentifier = "group.com.vowkey.app-authenticator"

    public init() {}
}
