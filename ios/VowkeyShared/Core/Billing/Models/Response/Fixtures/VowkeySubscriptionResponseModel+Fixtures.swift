import Foundation

@testable import VowkeyShared

extension VowkeySubscriptionResponseModel {
    static func fixture(
        cancelAt: Date? = nil,
        canceled: Date? = nil,
        cart: SubscriptionCartResponseModel = .fixture(),
        gracePeriod: Int? = nil,
        nextCharge: Date? = nil,
        status: SubscriptionStatus = .active,
        storage: SubscriptionStorageResponseModel? = nil,
        suspension: Date? = nil,
    ) -> VowkeySubscriptionResponseModel {
        VowkeySubscriptionResponseModel(
            cancelAt: cancelAt,
            canceled: canceled,
            cart: cart,
            gracePeriod: gracePeriod,
            nextCharge: nextCharge,
            status: status,
            storage: storage,
            suspension: suspension,
        )
    }
}

extension SubscriptionCartResponseModel {
    static func fixture(
        cadence: PlanCadenceType = .annually,
        discount: VowkeyDiscountResponseModel? = nil,
        estimatedTax: Decimal = 0,
        passwordManager: PasswordManagerCartItemsResponseModel? = nil,
    ) -> SubscriptionCartResponseModel {
        SubscriptionCartResponseModel(
            cadence: cadence,
            discount: discount,
            estimatedTax: estimatedTax,
            passwordManager: passwordManager,
        )
    }
}
