import Networking

struct GetEntitlementRequest: Request {
    typealias Response = EntitlementResponseModel

    var method: HTTPMethod { .get }
    var path: String { "/billing/entitlement" }
}
