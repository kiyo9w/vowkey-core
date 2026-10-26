import TestHelpers

/// `APITestData` helpers that load the resource from the `VowkeyKitMocks` bundle.
extension APITestData {
    static func loadFromBundle(resource: String, extension: String) -> APITestData {
        loadFromBundle(resource: resource, extension: `extension`, bundle: .vowkeyKitMocks)
    }

    static func loadFromJsonBundle(resource: String) -> APITestData {
        loadFromJsonBundle(resource: resource, bundle: .vowkeyKitMocks)
    }
}
