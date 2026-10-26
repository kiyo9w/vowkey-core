import AuthenticationServices
import VowkeySdk
import XCTest

@testable import VowkeyShared

// MARK: - ASAuthorizationPublicKeyCredentialDescriptorExtensionTests

class PublicKeyCredentialDescriptorExtensionsTests: VowkeyTestCase {
    // MARK: Tests

    /// `init(from:)` initializes a `PublicKeyCredentialDescriptor`
    /// from a `ASAuthorizationPublicKeyCredentialDescriptor`.
    func test_init_from() {
        let data = Data(capacity: 16)
        let asDescriptor = MockASAuthorizationPublicKeyCredentialDescriptor(credentialId: data)
        let descriptor = PublicKeyCredentialDescriptor(from: asDescriptor)
        XCTAssertEqual(asDescriptor.credentialID, descriptor.id)
        XCTAssertEqual(descriptor.ty, "public-key")
        XCTAssertNil(descriptor.transports)
    }
}

// MARK: - MockASAuthorizationPublicKeyCredentialDescriptor

/// A mock of `ASAuthorizationPublicKeyCredentialDescriptor`.
class MockASAuthorizationPublicKeyCredentialDescriptor: NSObject, ASAuthorizationPublicKeyCredentialDescriptor {
    // MARK: Properties

    static var supportsSecureCoding = false

    var credentialID: Data

    // MARK: Init

    init(credentialId: Data) {
        credentialID = credentialId
    }

    required init?(coder: NSCoder) {
        credentialID = Data(capacity: 16)
    }

    // MARK: Methods

    func copy(with zone: NSZone? = nil) -> Any {
        false
    }

    func encode(with coder: NSCoder) {
        // No-op
    }
}
