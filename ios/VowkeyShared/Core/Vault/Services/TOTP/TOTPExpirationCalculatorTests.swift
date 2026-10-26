import VowkeyKit
import VowkeyKitMocks
import Foundation
import Testing

@testable import VowkeyShared
@testable import VowkeySharedMocks

struct TOTPExpirationCalculatorTests {
    // MARK: Tests

    /// `listItemsByExpiration` correctly partitions items into expired and current groups.
    @Test
    func listItemsByExpiration() {
        let expired = VaultListItem.fixtureTOTP(
            totp: .fixture(
                totpCode: TOTPCodeModel(
                    code: "",
                    codeGenerationDate: Date(year: 2024, month: 1, day: 1, second: 29),
                    period: 30,
                ),
            ),
        )
        let current = VaultListItem.fixtureTOTP(
            totp: .fixture(
                totpCode: TOTPCodeModel(
                    code: "",
                    codeGenerationDate: Date(year: 2024, month: 1, day: 1, second: 31),
                    period: 30,
                ),
            ),
        )
        let expectation = [
            true: [
                expired,
            ],
            false: [
                current,
            ],
        ]
        #expect(
            expectation == TOTPExpirationCalculator.listItemsByExpiration(
                [current, expired],
                timeProvider: MockTimeProvider(
                    .mockTime(
                        Date(
                            year: 2024,
                            month: 1,
                            day: 1,
                            second: 31,
                        ),
                    ),
                ),
            ),
        )
    }
}
