import Foundation
import Testing

@testable import VowkeyShared
@testable import VowkeySharedMocks

// MARK: - SyncResponseModelTests

struct SyncResponseModelTests {
    @Test
    func decode_skipsUnsupportedCiphersWithoutDroppingOrdinaryItems() throws {
        let ordinary = CipherDetailsResponseModel.fixture(id: "ordinary", type: .login)
        let encoded = try JSONEncoder().encode(ordinary)
        let object = try #require(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        let supported = try #require(object["type"] as? Int)
        #expect(supported == 1)
        var key = object
        key["id"] = "key"
        key["type"] = 100
        key["apiKey"] = ["value": "encrypted-key"]
        var environment = object
        environment["id"] = "environment"
        environment["type"] = 101
        environment["environment"] = ["members": "encrypted-members"]
        var unknown = object
        unknown["id"] = "future"
        unknown["type"] = 250
        let data = try JSONSerialization.data(withJSONObject: [object, key, environment, unknown])

        let decoded = try JSONDecoder().decode(SupportedCipherList.self, from: data)

        #expect(decoded.wrappedValue.map(\.id) == ["ordinary"])
        #expect(throws: (any Error).self) {
            try JSONDecoder().decode(CipherDetailsResponseModel.self, from: JSONSerialization.data(withJSONObject: key))
        }
    }

    // MARK: effectivePolicies

    /// `effectivePolicies` returns an empty list when both `policies` and `policiesNew` are absent.
    @Test
    func effectivePolicies_bothListsAbsent() {
        let subject = SyncResponseModel.fixture(
            policies: nil,
            policiesNew: nil,
        )
        #expect(subject.effectivePolicies.isEmpty)
    }

    /// `effectivePolicies` uses `policies` when `policiesNew` is absent.
    @Test
    func effectivePolicies_fallsBackToPolicies() {
        let subject = SyncResponseModel.fixture(
            policies: [.fixture(id: "legacy")],
            policiesNew: nil,
        )
        #expect(subject.effectivePolicies.map(\.id) == ["legacy"])
    }

    /// `effectivePolicies` prefers `policiesNew` over `policies` when both are present.
    @Test
    func effectivePolicies_prefersPoliciesNew() {
        let subject = SyncResponseModel.fixture(
            policies: [.fixture(id: "legacy")],
            policiesNew: [.fixture(id: "new")],
        )
        #expect(subject.effectivePolicies.map(\.id) == ["new"])
    }

    /// `effectivePolicies` returns an empty list when `policiesNew` is present but empty, rather
    /// than falling back to `policies`.
    @Test
    func effectivePolicies_policiesNewEmpty() {
        let subject = SyncResponseModel.fixture(
            policies: [.fixture(id: "legacy")],
            policiesNew: [],
        )
        #expect(subject.effectivePolicies.isEmpty)
    }
}
