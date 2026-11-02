import Foundation
import VowkeySdk

/// Reads a document and matches an unseen form through the app-owned Decision service.
/// Literal label equality remains only the fallback when that service is unavailable.
enum NativeDecision {
    typealias Account = (CipherService, ClientService, StateService, APIService)

    static func read(text: String, account: Account?, userId: String?, installationId: String) async throws -> [String: Any] {
        let pieces = text
            .split(separator: "\n")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .map { ["text": $0, "x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0] as [String: Any] }
        let readingData = try JSONSerialization.data(withJSONObject: ["pages": [["index": 0, "aspect": 1.0, "pieces": pieces]]])
        guard let readingJson = String(data: readingData, encoding: .utf8) else { throw NativeVaultError.unreadable }
        var plan = try captureDecisionBegin(readingJson: readingJson, perRequest: 0)
        let firstAnswers = try await answerRequests(captureDecisionRequests(planJson: plan, secondRound: false), account: account, userId: userId, installationId: installationId)
        plan = try captureDecisionTakeFirstAnswers(planJson: plan, responsesJson: firstAnswers)
        let secondAnswers = try await answerRequests(captureDecisionRequests(planJson: plan, secondRound: true), account: account, userId: userId, installationId: installationId)
        let year = UInt16(Calendar.current.component(.year, from: Date()))
        let finishedJson = try captureDecisionFinish(planJson: plan, responsesJson: secondAnswers, extraText: "", currentYear: year)
        guard let finishedData = finishedJson.data(using: .utf8),
              let parsed = try JSONSerialization.jsonObject(with: finishedData) as? [String: Any],
              let details = parsed["details"] as? [String: String], !details.isEmpty else {
            throw NativeVaultError.unreadable
        }
        return ["details": details, "sources": parsed["sources"] as? [String: Any] ?? [:]]
    }

    private static func answerRequests(_ requestsJson: String, account: Account?, userId: String?, installationId: String) async throws -> String {
        guard let reqData = requestsJson.data(using: .utf8),
              let requests = try JSONSerialization.jsonObject(with: reqData) as? [[String: Any]] else {
            throw NativeVaultError.unreadable
        }
        var responses: [[String: Any]] = []
        for req in requests {
            var allowed: [String: Any] = [:]
            if let state = req["state"] { allowed["state"] = state }
            if let questions = req["questions"] { allowed["questions"] = questions }
            if let model = req["model"] { allowed["model"] = model }
            responses.append(try await send("/v1/systemone", body: allowed, account: account, userId: userId, installationId: installationId))
        }
        let out = try JSONSerialization.data(withJSONObject: responses)
        return String(data: out, encoding: .utf8) ?? "[]"
    }

    static func match(label: String, section: String, profiles: [CipherView], account: Account?, userId: String?, installationId: String) async throws -> String? {
        let request: [String: Any] = [
            "v": 1, "targetId": UUID().uuidString.lowercased(), "formSignature": "\(section)|\(label)",
            "sections": [["id": section, "label": section]],
            "fields": [["id": label, "sectionId": section, "label": label, "type": "text", "options": []]],
        ]
        let response = try await send("/v1/forms/describe", body: request, account: account, userId: userId, installationId: installationId)
        guard let fields = response["fields"] as? [[String: Any]], let field = fields.first else { return nil }
        let owner = (field["owner"] as? String) ?? "applicant"
        guard owner == "applicant" else { return nil }
        guard let attribute = (field["attribute"] as? String) ?? (field["detail"] as? String) ?? (field["what"] as? String),
              !attribute.isEmpty, attribute != "none" else { return nil }
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
        guard !token.isEmpty, let url = URL(string: "https://decision.vowkey.app\(path)") else { throw NativeVaultError.unavailable }
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
        guard let url = URL(string: "https://identity.vowkey.app/guest-decision/grant") else { throw NativeVaultError.unavailable }
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
