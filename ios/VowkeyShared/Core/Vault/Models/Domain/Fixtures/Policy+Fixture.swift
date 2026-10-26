import VowkeyKit
import Foundation

@testable import VowkeyShared

extension Policy {
    static func fixture(
        data: [String: AnyCodable]? = nil,
        enabled: Bool = true,
        id: String = "policy-1",
        organizationId: String = "organization-1",
        revisionDate: Date? = nil,
        type: PolicyType = .twoFactorAuthentication,
    ) -> Policy {
        Policy(
            data: data,
            enabled: enabled,
            id: id,
            organizationId: organizationId,
            revisionDate: revisionDate,
            type: type,
        )
    }
}
