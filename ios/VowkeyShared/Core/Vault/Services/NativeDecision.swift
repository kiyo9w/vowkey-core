import Foundation
import VowkeySdk

/// Reads a document and matches an unseen form through the app-owned Decision service.
/// Literal label equality remains only the fallback when that service is unavailable.
enum NativeDecision {
    typealias Account = (CipherService, ClientService, StateService, APIService)

    static func read(text: String, account: Account?, userId: String?, installationId: String) async throws -> [String: Any] {
        let pieces = text.split(separator: "\n").map { ["text": String($0)] }.filter { !($0["text"] ?? "").trimmingCharacters(in: .whitespaces).isEmpty }
        let request: [String: Any] = ["state": ["document": ["pages": [["index": 0, "pieces": pieces]]]], "questions": ["details": true]]
        let response = try await send("/v1/systemone", body: request, account: account, userId: userId, installationId: installationId)
        guard let details = response["details"] as? [String: String], !details.isEmpty else { throw NativeVaultError.unreadable }
        return ["details": details, "sources": response["sources"] as? [String: Any] ?? [:]]
    }

    static func match(label: String, section: String, profiles: [CipherView], account: Account?, userId: String?, installationId: String) async throws -> String? {
        let request: [String: Any] = [
            "v": 1, "targetId": UUID().uuidString.lowercased(), "formSignature": "\(section)|\(label)",
            "sections": [["id": section, "label": section]],
            "fields": [["id": label, "sectionId": section, "label": label, "type": "text", "options": []]],
        ]
        let response = try await send("/v1/forms/describe", body: request, account: account, userId: userId, installationId: installationId)
        guard let fields = response["fields"] as? [[String: Any]], let field = fields.first,
              let attribute = field["attribute"] as? String ?? field["detail"] as? String else { return nil }
        for profile in profiles {
            if let detail = NativeProfile.details(profile).first(where: { $0["attribute"] as? String == attribute }),
               let value = NativeProfile.value(detail) { return value }
        }
        return nil
    }

    private static func send(_ path: String, body: [String: Any], account: Account?, userId: String?, installationId: String) async throws -> [String: Any] {
        let token = if let account, userId != nil {
            try await account.3.accountTokenProvider.getToken() ?? ""
        } else {
            try await guestToken(installationId)
        }
        guard !token.isEmpty, let url = URL(string: "https://decision.vowkey.com\(path)") else { throw NativeVaultError.unavailable }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else { throw NativeVaultError.unavailable }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }

    private static func guestToken(_ installationId: String) async throws -> String {
        guard let url = URL(string: "https://identity.vowkey.com/guest-decision/grant") else { throw NativeVaultError.unavailable }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["installationId": installationId])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String else { throw NativeVaultError.unavailable }
        return token
    }
}
