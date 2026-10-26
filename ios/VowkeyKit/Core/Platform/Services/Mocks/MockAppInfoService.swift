import VowkeyKit
import Foundation

public class MockAppInfoService: AppInfoService {
    public var appInfoStringValue = """
    © Vowkey Inc. 2015\(String.enDash)\(Calendar.current.component(.year, from: Date.now))

    📝 Vowkey 1.0 (1)
    📦 Bundle: com.vowkey.app
    📱 Device: iPhone14,2
    🍏 System: iOS 16.4
    """
    public var appInfoWithoutCopyrightStringValue = """
    📝 Vowkey 1.0 (1)
    📦 Bundle: com.vowkey.app
    📱 Device: iPhone14,2
    🍏 System: iOS 16.4
    """
    public var copyrightString = """
    © Vowkey Inc. 2015\(String.enDash)\(Calendar.current.component(.year, from: Date.now))
    """
    public var isBetaBuild = false
    public var versionString = "1.0 (1)"

    public var appInfoString: String {
        get async {
            appInfoStringValue
        }
    }

    public var appInfoWithoutCopyrightString: String {
        get async {
            appInfoWithoutCopyrightStringValue
        }
    }

    public init() {}
}
