import VowkeySdk

struct CipherApiKeyModel: Codable, Equatable {
    var value: String?
    var sendStyle: String?
    var allowedHosts: String?
    var headerName: String?
    var basicUsername: String?

    init(apiKey: VowkeySdk.ApiKey) {
        value = apiKey.value
        sendStyle = apiKey.sendStyle
        allowedHosts = apiKey.allowedHosts
        headerName = apiKey.headerName
        basicUsername = apiKey.basicUsername
    }
}

extension VowkeySdk.ApiKey {
    init(_ model: CipherApiKeyModel) {
        self.init(value: model.value, sendStyle: model.sendStyle, allowedHosts: model.allowedHosts,
                  headerName: model.headerName, basicUsername: model.basicUsername)
    }
}
