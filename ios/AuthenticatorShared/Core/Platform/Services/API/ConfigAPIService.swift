// swiftlint:disable:this file_name

import VowkeyKit
import Networking

extension APIService: ConfigAPIService {
    func getConfig() async throws -> ConfigResponseModel {
        try await apiUnauthenticatedService.send(ConfigRequest())
    }
}
