import Foundation
import Networking

/// Posts one allowlisted count. Nothing leaves unless the person turned the switch on,
/// and the body is only the names and numbers the server keeps.
public enum UsageCounts {
    public static func recordFill(_ services: ServiceContainer, filled: Int = 1, close: Int = 0, left: Int = 0) {
        guard services.appSettingsStore.shareUsageCounts else { return }
        let locale = allowedLocale(services.appSettingsStore.appLocale)
        let body = CountRequestModel(locale: locale, page: "\(filled):\(close):\(left)")
        Task {
            _ = try? await services.apiService.apiUnauthenticatedService.send(CountRequest(body: body))
        }
    }

    /// The server drops a locale outside its list, so an unknown one is sent as English.
    private static func allowedLocale(_ stored: String?) -> String {
        let code = stored ?? Locale.current.identifier
        let allowed = ["en", "vi", "ja", "ko", "zh-CN", "zh-TW", "es", "fr", "de", "pt-BR"]
        if allowed.contains(code) { return code }
        if code.hasPrefix("zh-Hans") || code == "zh-CN" { return "zh-CN" }
        if code.hasPrefix("zh") { return "zh-TW" }
        let language = code.split(separator: "-").first.map(String.init) ?? ""
        return allowed.contains(language) ? language : "en"
    }
}

struct CountRequest: Request {
    typealias Response = EmptyResponse

    let body: CountRequestModel?
    let method: HTTPMethod = .post
    let path = "/counts"
}

struct CountRequestModel: JSONRequestBody, Equatable {
    static let encoder = JSONEncoder()

    let event = "fill_outcome"
    let surface = "ios"
    let os = "ios"
    let locale: String
    /// Filled, close, and left, as numbers. No address and no field value.
    let page: String
    let count = 1
}
