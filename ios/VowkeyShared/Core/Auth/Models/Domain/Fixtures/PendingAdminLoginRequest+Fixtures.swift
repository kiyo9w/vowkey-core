import VowkeySdk

@testable import VowkeyShared

extension PendingAdminLoginRequest {
    static func fixture(
        id: String = "ID",
        authRequestResponse: AuthRequestResponse = AuthRequestResponse.fixture(),
    ) -> PendingAdminLoginRequest {
        PendingAdminLoginRequest(
            id: id,
            authRequestResponse: authRequestResponse,
        )
    }
}
