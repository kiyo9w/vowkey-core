import Foundation

class VowkeyKitMocksBundleFinder {
    static let bundle = Bundle(for: VowkeyKitMocksBundleFinder.self)
}

public extension Bundle {
    /// The bundle for the `VowkeyKitMocks` target.
    static let vowkeyKitMocks = VowkeyKitMocksBundleFinder.bundle
}
