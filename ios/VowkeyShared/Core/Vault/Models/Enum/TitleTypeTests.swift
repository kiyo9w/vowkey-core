import VowkeyResources
import Testing

@testable import VowkeyShared

struct TitleTypeTests {
    // MARK: Tests

    /// `defaultValueLocalizedName` is the localized `None` placeholder shown when no title is
    /// selected.
    @Test
    func defaultValueLocalizedName_isNone() {
        #expect(TitleType.defaultValueLocalizedName == Localizations.none)
    }
}
