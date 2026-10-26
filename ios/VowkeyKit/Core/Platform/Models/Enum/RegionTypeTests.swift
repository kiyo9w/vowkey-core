import VowkeyKit
import Foundation
import Testing

// MARK: - RegionTypeTests

struct RegionTypeTests {
    // MARK: Tests

    /// `init(baseURL:)` resolves an environment base URL to the matching region.
    @Test(arguments: [
        (EnvironmentURLData.defaultUS.base, RegionType.unitedStates),
        (EnvironmentURLData.defaultEU.base, RegionType.europe),
        (URL(string: "https://vowkey.pw"), RegionType.internal),
        (URL(string: "https://qa-team.sh.vowkey.pw"), RegionType.internal),
        (URL(string: "https://notvowkey.pw"), RegionType.selfHosted),
        (URL(string: "https://selfhosted.com"), RegionType.selfHosted),
        (nil, RegionType.selfHosted),
    ])
    func initBaseURL(baseURL: URL?, expectedRegion: RegionType) {
        #expect(RegionType(baseURL: baseURL) == expectedRegion)
    }
}
