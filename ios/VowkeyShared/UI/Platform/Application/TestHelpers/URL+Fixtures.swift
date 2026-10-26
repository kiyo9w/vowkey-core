import Foundation

#if DEBUG
extension URL {
    static let vowkeyAccountSecurity = URL(string: "vowkey://settings/account_security")!
    static let vowkeyAuthenticatorNewItem = URL(string: "vowkey://authenticator/newItem")!
    static let vowkeyInvalidPath = URL(string: "vowkey://unsupported/urll")!
    static let vowkeySchemeOnly = URL(string: "vowkey://")!
    static let vowkeySSOCookieVendor = URL(string: "vowkey://sso-cookie-vendor?auth=token123&session=abc")!
    static let vowkeySSOCookieVendorNoCookies = URL(string: "vowkey://sso-cookie-vendor")!
    static let vowkeySSOCookieVendorDParam = URL(string: "vowkey://sso-cookie-vendor?d=ignored&auth=myToken")!
}
#endif
