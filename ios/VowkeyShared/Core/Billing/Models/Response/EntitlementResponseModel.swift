import Networking

struct EntitlementResponseModel: JSONResponse, Equatable {
    struct Personal: JSONResponse, Equatable {
        let basePlan: String
    }

    let personal: Personal
}
