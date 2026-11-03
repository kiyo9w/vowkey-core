import Foundation
import Networking
import VowkeyResources

struct AgentSyncResponse: Decodable {
    let revision: Int
    let pairings: [AgentPairingRow]
    let requests: [AgentRequestRow]
    let grants: [AgentGrantRow]
    let activity: [AgentActivityRow]
}

struct AgentPairingRow: Decodable, Identifiable {
    let pairingId: String
    let localExecutorId: String
    let executorDeviceId: String?
    let encryptedMetadata: String
    let revokedAt: String?
    let revision: Int
    var id: String { pairingId }
}

struct AgentRequestRow: Decodable, Identifiable {
    let requestId: String
    let cipherIds: [String]
    let routing: String
    let note: String?
    var answer: String?
    let result: String?
    var status: String
    let receivedAt: String
    let deadline: String
    var answerRevision: Int
    let revision: Int
    var id: String { requestId }
}

struct AgentGrantRow: Decodable, Identifiable {
    let grantId: String
    let sourceCipherId: String?
    let encryptedGrant: String
    let revokedAt: String?
    let revision: Int
    var id: String { grantId }
}

struct AgentActivityRow: Decodable, Identifiable {
    let id: String
    let kind: String
    let requestId: String?
    let sourceCipherId: String?
    let encryptedActivity: String
    let organizationId: String?
    let createdAt: String
}

struct AgentActivityPayload: Decodable {
    let kind: String
    let requestId: String?
    let sourceCipherId: String?
    let reference: String?
    let destinationKey: String?
    let pairingId: String?
    let answer: String?
    let outcome: String
    let askReason: String?
    let method: String?
    let host: String?
    let port: Int?
}

struct AgentActivityItem: Identifiable {
    let row: AgentActivityRow
    let payload: AgentActivityPayload
    var id: String { row.id }
    var needsLook: Bool {
        ["not_allowed", "no_access", "never", "not_written", "not_confirmed", "unmatched", "timed_out"]
            .contains(payload.outcome) || payload.answer == "deny" || payload.askReason == "site_not_listed"
    }
    var statusLabel: String {
        switch payload.outcome {
        case "confirmed": Localizations.vowkeyIntroDocRowFilled
        case "not_allowed", "no_access", "never": Localizations.vowkeyAgentStatusNotAllowed
        case "timed_out": Localizations.vowkeyAgentStatusTimedOut
        default: Localizations.vowkeyAgentStatusNotFilled
        }
    }
}

struct AgentResult: Decodable {
    let v: Int
    let requestId: String
    let status: String
}

struct AgentPairingMetadata: Decodable {
    let v: Int
    let pairingId: String
    let displayName: String
    let localExecutorId: String
    let executorDeviceId: String?
    let createdAt: String
    let revokedAt: String?
}

struct AgentRouting: Decodable {
    struct Section: Decodable, Identifiable {
        let id: String
        let label: String
    }

    struct Entry: Decodable, Identifiable {
        let entryId: String
        let fieldId: String
        let cipherId: String
        let fieldPath: String
        let revisionDate: String
        let profileId: String?
        let sectionId: String
        let label: String
        var id: String { entryId }
    }

    let v: Int
    let requestId: String
    let pairingId: String
    let targetDisplay: String
    let destinationKey: String
    let sections: [Section]
    let entries: [Entry]
    let askReason: String?

    func validate(for row: AgentRequestRow) throws {
        let sectionIds = Set(sections.map(\.id))
        guard v == 1, requestId == row.requestId, UUID(uuidString: requestId) != nil,
              UUID(uuidString: pairingId) != nil, !targetDisplay.isEmpty, !destinationKey.isEmpty,
              !sections.isEmpty, sectionIds.count == sections.count, !sectionIds.contains(""),
              !entries.isEmpty, entries.count <= 100,
              Set(entries.map(\.entryId)).count == entries.count,
              entries.allSatisfy({
                  !$0.entryId.isEmpty && !$0.fieldId.isEmpty && !$0.fieldPath.isEmpty && !$0.label.isEmpty
                      && sectionIds.contains($0.sectionId) && row.cipherIds.contains($0.cipherId)
                      && UUID(uuidString: $0.cipherId) != nil
                      && ($0.profileId == nil || UUID(uuidString: $0.profileId!) != nil)
              }) else { throw AgentManagementError.invalidPayload }
    }

    func needsProfileChoice(sectionId: String) -> Bool {
        let sectionEntries = entries.filter { $0.sectionId == sectionId }
        return Set(sectionEntries.compactMap(\.profileId)).count > 1
            || sectionEntries.contains { $0.profileId == nil && $0.fieldPath.hasPrefix("detail.") }
    }
}

struct AgentRequestNote: Decodable {
    let v: Int
    let requestId: String
    let goal: String
    let reason: String
}

enum AgentAnswerKind: String, Codable {
    case allowOnce = "allow_once"
    case alwaysAllow = "always_allow"
    case deny
}

struct AgentAnswer: Codable {
    let v: Int
    let requestId: String
    let answer: AgentAnswerKind
    let selectedEntryIds: [String]
    let sectionProfiles: [String: String]
    let answeredAt: String

    func validate(routing: AgentRouting, accessibleProfiles: Set<String>? = nil) throws {
        let selected = Set(selectedEntryIds)
        let sectionIds = Set(routing.sections.map(\.id))
        guard v == 1, requestId == routing.requestId,
              selected.count == selectedEntryIds.count,
              selected.isSubset(of: Set(routing.entries.map(\.entryId))),
              AgentManagementDate.parse(answeredAt) != nil,
              sectionProfiles.allSatisfy({ sectionIds.contains($0.key) && UUID(uuidString: $0.value) != nil }),
              accessibleProfiles.map({ profiles in sectionProfiles.values.allSatisfy { profiles.contains($0) } }) ?? true
        else { throw AgentManagementError.invalidPayload }
        if answer == .deny {
            guard selected.isEmpty, sectionProfiles.isEmpty else { throw AgentManagementError.invalidPayload }
            return
        }
        guard !selected.isEmpty else { throw AgentManagementError.nothingSelected }
        for entry in routing.entries where selected.contains(entry.entryId) {
            if routing.needsProfileChoice(sectionId: entry.sectionId) {
                guard let profile = sectionProfiles[entry.sectionId],
                      entry.profileId == nil || entry.profileId == profile
                else { throw AgentManagementError.profileRequired }
            }
        }
    }
}

struct AgentGrantPayload: Codable {
    let v: Int
    let requestId: String
    let pairingId: String
    let destinationKey: String
    let cipherId: String
    let fieldPath: String
    var revokedAt: String?

    func validate(for row: AgentGrantRow) throws {
        guard v == 1, UUID(uuidString: requestId) != nil, UUID(uuidString: pairingId) != nil,
              cipherId == row.sourceCipherId, !destinationKey.isEmpty, !fieldPath.isEmpty
        else { throw AgentManagementError.invalidPayload }
    }
}

struct AgentPairingItem: Identifiable {
    let row: AgentPairingRow
    let metadata: AgentPairingMetadata
    var id: String { row.id }
}

struct AgentRequestItem: Identifiable {
    var row: AgentRequestRow
    let routing: AgentRouting
    var note: AgentRequestNote?
    var answer: AgentAnswer?
    var result: AgentResult? = nil
    var id: String { row.id }
    var canAnswer: Bool {
        row.status == "pending" && row.answer == nil && row.result == nil
            && (AgentManagementDate.parse(row.deadline).map { $0 > Date() } ?? false)
    }

    var statusLabel: String {
        switch result?.status ?? row.status {
        case "pending": Localizations.vowkeyAgentStatusWaiting
        case "answered":
            answer?.answer == .deny
                ? Localizations.vowkeyAgentStatusNotAllowed
                : Localizations.vowkeyAgentStatusWaitingOtherDevice
        case "timed_out": Localizations.vowkeyAgentStatusTimedOut
        case "executor_unavailable": Localizations.vowkeyAgentStatusOtherDeviceUnavailable
        case "confirmed": Localizations.vowkeyIntroDocRowFilled
        case "not_allowed": Localizations.vowkeyAgentStatusNotAllowed
        case "not_written", "not_confirmed": Localizations.vowkeyAgentStatusNotFilled
        case "account_changed": Localizations.vowkeyAgentStatusAccountChanged
        default: Localizations.vowkeyAgentStatusAnswered
        }
    }
}

struct AgentGrantItem: Identifiable {
    let row: AgentGrantRow
    let payload: AgentGrantPayload
    var id: String { row.id }
}

struct AgentProfileOption: Identifiable, Equatable {
    let id: String
    let name: String
}

struct AgentConflict: Decodable {
    let code: String
    let revision: Int?
    let answer: String?
    let status: String?
}

enum AgentManagementError: Error {
    case invalidPayload
    case accountChanged
    case locked
    case nothingSelected
    case profileRequired
    case http(Int)
    case conflict(AgentConflict)
}

enum AgentManagementDate {
    static func parse(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }

    static func string(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}

struct AgentManagementRequest: Request {
    struct Response: Networking.Response {
        let data: Data
        init(response: HTTPResponse) throws { data = response.body }
    }

    let path: String
    let method: HTTPMethod
    let body: Data?
    let token: String
    var headers: [String: String] { ["Authorization": "Bearer \(token)", "Content-Type": "application/json"] }

    func validate(_ response: HTTPResponse) throws {
        if response.statusCode == 409 {
            throw AgentManagementError.conflict(try JSONDecoder().decode(AgentConflict.self, from: response.body))
        }
        guard (200..<300).contains(response.statusCode) else {
            throw AgentManagementError.http(response.statusCode)
        }
    }
}
