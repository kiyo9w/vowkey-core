// MARK: - VowkeyDiscountType

/// The type of discounts Vowkey supports.
///
enum VowkeyDiscountType: String, Codable, Equatable, Sendable {
    /// A fixed-amount discount.
    case amountOff = "amount-off"

    /// A percentage discount.
    case percentOff = "percent-off"
}
