import VowkeyKit
import VowkeyResources
import Foundation

// MARK: - DefaultSaveOption

/// The default location for saving newly added keys via QR code scan and Manual entry.
///
enum DefaultSaveOption: String, Equatable, Menuable {
    /// Ask where to save a code each time a QR code is scanned.
    case none

    /// Save the code locally without showing any prompt.
    case saveHere

    /// Take the user to the Vowkey PM app to save the code without prompt.
    case saveToVowkey

    /// All of the cases to show in the menu, in order.
    static let allCases: [Self] = [
        .saveToVowkey,
        .saveHere,
        .none,
    ]

    /// The name of the value to display in the menu.
    var localizedName: String {
        switch self {
        case .none:
            Localizations.none
        case .saveHere:
            Localizations.saveHere
        case .saveToVowkey:
            Localizations.saveToVowkey
        }
    }
}
