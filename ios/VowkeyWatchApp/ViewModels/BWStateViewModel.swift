import Foundation

class BWStateViewModel: ObservableObject {
    @Published var text: String
    @Published var isLoading: Bool = false

    init(_ state: BWState, _ defaultText: String?) {
        switch state {
        case .needLogin:
            text = "LogInToVowkeyOnYourIPhoneToViewVerificationCodes"
//        case .needUnlock:
//            text = "UnlockVowkeyOnYourIPhoneToViewVerificationCodes"
        case .needPremium:
            text = "ToViewVerificationCodesUpgradeToPremium"
        case .needSetup:
            text = "SetUpVowkeyToViewItemsContainingVerificationCodes"
        case .syncing:
            text = "SyncingItemsContainingVerificationCodes"
            isLoading = true
        case .need2FAItem:
            text = "Add2FactorAutenticationToAnItemToViewVerificationCodes"
        case .needDeviceOwnerAuth:
            text = "SetUpAppleWatchPasscodeInOrderToUseVowkey"
        default:
            text = defaultText ?? ""
        }
    }
}
