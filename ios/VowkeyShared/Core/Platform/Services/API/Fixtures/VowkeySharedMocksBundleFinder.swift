import Foundation

class VowkeySharedMocksBundleFinder {
    static let bundle = Bundle(for: VowkeySharedMocksBundleFinder.self)
}

public extension Bundle {
    /// The `Bundle` instance for the `VowkeySharedMocks` target.
    static let vowkeySharedMocks = VowkeySharedMocksBundleFinder.bundle
}
