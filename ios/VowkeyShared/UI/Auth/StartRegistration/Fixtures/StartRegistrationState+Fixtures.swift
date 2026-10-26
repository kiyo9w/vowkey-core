import VowkeyKit
import VowkeySdk
import Foundation

@testable import VowkeyShared

extension StartRegistrationState {
    static func fixture(
        emailText: String = "example@email.com",
        isReceiveMarketingToggleOn: Bool = true,
        nameText: String = "name",
        region: RegionType = .unitedStates,
    ) -> Self {
        StartRegistrationState(
            emailText: emailText,
            isReceiveMarketingToggleOn: isReceiveMarketingToggleOn,
            nameText: nameText,
            region: region,
        )
    }
}
