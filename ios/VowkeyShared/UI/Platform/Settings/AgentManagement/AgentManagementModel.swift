import Combine
import Foundation
import Networking
import VowkeySdk

@MainActor
final class AgentManagementModel: ObservableObject {
    typealias Services = HasAPIService & HasClientService & HasStateService & HasAuthRepository & HasCipherService

    @Published private(set) var requests: [AgentRequestItem] = []
    @Published private(set) var pairings: [AgentPairingItem] = []
    @Published private(set) var grants: [AgentGrantItem] = []
    @Published private(set) var activity: [AgentActivityItem] = []
    @Published private(set) var profiles: [AgentProfileOption] = []
    @Published private(set) var cipherNames: [String: String] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var isSaving = false
    @Published private(set) var message: String?

    private let services: Services
    private var userId: String?
    private var generation = UUID()

    init(services: Services) {
        self.services = services
    }

    func observeAccount() async {
        for await activeId in await services.stateService.activeAccountIdPublisher().values {
            guard !Task.isCancelled else { return }
            if let userId, activeId != userId {
                clear()
                message = "Account changed. Open AI agents again for this account."
                return
            }
        }
    }

    func clear() {
        generation = UUID()
        requests = []
        pairings = []
        grants = []
        activity = []
        profiles = []
        cipherNames = [:]
        userId = nil
        message = nil
    }

    func refresh() async {
        guard !isLoading, !isSaving else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let accountId = try await services.stateService.getActiveAccountId()
            if let userId, userId != accountId { throw AgentManagementError.accountChanged }
            userId = accountId
            let expectedGeneration = generation
            let sync: AgentSyncResponse = try await send(path: "/agent/sync", method: .get, userId: accountId)
            var nextPairings: [AgentPairingItem] = []
            var nextRequests: [AgentRequestItem] = []
            var nextGrants: [AgentGrantItem] = []
            var unreadable = false
            for row in sync.pairings {
                do {
                    let metadata: AgentPairingMetadata = try await decrypt(row.encryptedMetadata, userId: accountId)
                    guard metadata.v == 1, metadata.pairingId == row.id,
                          metadata.localExecutorId == row.localExecutorId,
                          metadata.executorDeviceId == row.executorDeviceId,
                          !metadata.displayName.isEmpty else { throw AgentManagementError.invalidPayload }
                    nextPairings.append(AgentPairingItem(row: row, metadata: metadata))
                } catch { unreadable = true }
            }
            for row in sync.requests {
                do {
                    let routing: AgentRouting = try await decrypt(row.routing, userId: accountId)
                    try routing.validate(for: row)
                    var note: AgentRequestNote?
                    if row.status == "pending", row.answer == nil,
                       AgentManagementDate.parse(row.deadline).map({ $0 > Date() }) == true,
                       let encrypted = row.note {
                        let decoded: AgentRequestNote = try await decrypt(encrypted, userId: accountId)
                        guard decoded.v == 1, decoded.requestId == row.id else {
                            throw AgentManagementError.invalidPayload
                        }
                        note = decoded
                    }
                    var answer: AgentAnswer?
                    if let encrypted = row.answer {
                        answer = try await decrypt(encrypted, userId: accountId)
                        try answer?.validate(routing: routing)
                    }
                    var result: AgentResult?
                    if let encrypted = row.result {
                        let decoded: AgentResult = try await decrypt(encrypted, userId: accountId)
                        guard decoded.v == 1, decoded.requestId == row.id else { throw AgentManagementError.invalidPayload }
                        result = decoded
                    }
                    nextRequests.append(AgentRequestItem(row: row, routing: routing, note: note, answer: answer, result: result))
                } catch { unreadable = true }
            }
            for row in sync.grants {
                do {
                    let payload: AgentGrantPayload = try await decrypt(row.encryptedGrant, userId: accountId)
                    try payload.validate(for: row)
                    nextGrants.append(AgentGrantItem(row: row, payload: payload))
                } catch { unreadable = true }
            }
            var nextProfiles: [AgentProfileOption] = []
            var nextNames: [String: String] = [:]
            for cipher in try await services.cipherService.fetchAllCiphers() {
                let view = try await services.clientService.vault(for: accountId).ciphers().decrypt(cipher: cipher)
                guard let id = view.id, view.deletedDate == nil else { continue }
                nextNames[id] = view.name
                if Self.isConfirmedProfile(view) { nextProfiles.append(AgentProfileOption(id: id, name: view.name)) }
            }
            var nextActivity: [AgentActivityItem] = []
            for row in sync.activity {
                do {
                    let payload: AgentActivityPayload
                    if row.organizationId != nil, let sourceId = row.sourceCipherId,
                       let source = try await services.cipherService.fetchCipher(withId: sourceId),
                       source.organizationId == row.organizationId {
                        let carrier = NativeCipher.encryptedCarrier(row.encryptedActivity, organizationId: source.organizationId)
                        let view = try await services.clientService.vault(for: accountId).ciphers().decrypt(cipher: carrier)
                        payload = try JSONDecoder().decode(AgentActivityPayload.self, from: Data(view.name.utf8))
                    } else if row.organizationId == nil {
                        payload = try await decrypt(row.encryptedActivity, userId: accountId)
                    } else { throw AgentManagementError.invalidPayload }
                    guard payload.kind == row.kind, payload.requestId == row.requestId,
                          payload.sourceCipherId == row.sourceCipherId else { throw AgentManagementError.invalidPayload }
                    nextActivity.append(AgentActivityItem(row: row, payload: payload))
                } catch { unreadable = true }
            }
            try await requireAccount(accountId)
            guard generation == expectedGeneration else { return }
            pairings = nextPairings.sorted { $0.metadata.displayName.localizedStandardCompare($1.metadata.displayName) == .orderedAscending }
            requests = nextRequests.sorted { $0.row.receivedAt > $1.row.receivedAt }
            grants = nextGrants
            activity = nextActivity.sorted { $0.row.createdAt > $1.row.createdAt }
            profiles = nextProfiles.sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
            cipherNames = nextNames
            message = unreadable ? "Some AI agent records couldn't be read. Sync and try again." : nil
        } catch {
            handle(error, fallback: "Couldn't load AI agents. Check your connection and try again.")
        }
    }

    @discardableResult
    func answer(
        requestId: String,
        kind: AgentAnswerKind,
        selectedEntryIds: Set<String>,
        sectionProfiles: [String: String],
    ) async -> Bool {
        guard !isSaving, let item = requests.first(where: { $0.id == requestId }), item.canAnswer,
              let userId else { return false }
        isSaving = true
        defer { isSaving = false }
        do {
            try await requireAccount(userId)
            let answer = AgentAnswer(
                v: 1,
                requestId: requestId,
                answer: kind,
                selectedEntryIds: kind == .deny ? [] : item.routing.entries.map(\.entryId).filter(selectedEntryIds.contains),
                sectionProfiles: kind == .deny ? [:] : sectionProfiles,
                answeredAt: AgentManagementDate.string(Date()),
            )
            try answer.validate(routing: item.routing, accessibleProfiles: Set(profiles.map(\.id)))
            let encrypted = try await encrypt(answer, userId: userId)
            let body = try JSONEncoder().encode(AnswerBody(revision: item.row.answerRevision, answer: encrypted))
            let row: AgentRequestRow = try await send(
                path: "/agent/requests/\(requestId)/answer", method: .put, body: body, userId: userId,
            )
            guard row.id == requestId, let winner = row.answer else { throw AgentManagementError.invalidPayload }
            let decoded: AgentAnswer = try await decrypt(winner, userId: userId)
            try decoded.validate(routing: item.routing)
            try await requireAccount(userId)
            replaceRequest(item, row: row, answer: decoded)
            message = nil
            return true
        } catch AgentManagementError.conflict(let conflict) {
            do {
                try await requireAccount(userId)
                var current = item.row
                if conflict.code == "already_resolved", let revision = conflict.revision, let encrypted = conflict.answer {
                    let winner: AgentAnswer = try await decrypt(encrypted, userId: userId)
                    try winner.validate(routing: item.routing)
                    current.answerRevision = revision
                    current.answer = encrypted
                    current.status = "answered"
                    replaceRequest(item, row: current, answer: winner)
                    message = "This request was answered on another device."
                } else if conflict.code == "deadline_passed", conflict.status == "timed_out" {
                    current.status = "timed_out"
                    replaceRequest(item, row: current, answer: nil)
                    message = "This request timed out."
                } else { throw AgentManagementError.invalidPayload }
                isSaving = false
                await refresh()
                if conflict.code == "already_resolved" { message = "This request was answered on another device." }
                if conflict.code == "deadline_passed" { message = "This request timed out." }
                return true
            } catch {
                handle(error, fallback: "Couldn't read the current answer. Refresh before trying again.")
            }
        } catch {
            handle(error, fallback: "Couldn't send the answer. Check your connection and try again.")
        }
        return false
    }

    func revokePairing(_ item: AgentPairingItem) async {
        await revoke(path: "/agent/pairings/\(item.id)") { _ in
            try JSONEncoder().encode(PairingBody(revision: item.row.revision, revokedAt: AgentManagementDate.string(Date())))
        }
    }

    func revokeGrant(_ item: AgentGrantItem) async {
        await revoke(path: "/agent/grants/\(item.id)") { userId in
            var payload = item.payload
            let revokedAt = AgentManagementDate.string(Date())
            payload.revokedAt = revokedAt
            let encrypted = try await self.encrypt(payload, userId: userId)
            return try JSONEncoder().encode(GrantBody(revision: item.row.revision, encryptedGrant: encrypted, revokedAt: revokedAt))
        }
    }

    func agentName(pairingId: String) -> String {
        pairings.first { $0.id == pairingId }?.metadata.displayName ?? "AI agent"
    }

    static func isConfirmedProfile(_ cipher: CipherView) -> Bool {
        guard cipher.type == .identity, cipher.deletedDate == nil,
              let value = cipher.fields?.first(where: { $0.name == "vk.meta" })?.value,
              let data = value.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return false }
        return object["v"] as? Int == 1 && object["status"] as? String == "confirmed"
            && object["details"] is [Any] && object["sources"] is [Any]
    }

    private func revoke(path: String, body: (String) async throws -> Data) async {
        guard !isSaving, let userId else { return }
        isSaving = true
        var outcome: String?
        do {
            let data = try await body(userId)
            let _: AgentManagementRequest.Response = try await sendRaw(path: path, method: .put, body: data, userId: userId)
        } catch AgentManagementError.conflict {
            outcome = "This setting changed on another device. Review its current state and try again."
        } catch {
            handle(error, fallback: "Couldn't revoke access. Check your connection and try again.")
            isSaving = false
            return
        }
        isSaving = false
        await refresh()
        if let outcome { message = outcome }
    }

    private func replaceRequest(_ item: AgentRequestItem, row: AgentRequestRow, answer: AgentAnswer?) {
        guard let index = requests.firstIndex(where: { $0.id == item.id }) else { return }
        requests[index] = AgentRequestItem(row: row, routing: item.routing, note: nil, answer: answer, result: item.result)
    }

    private func requireAccount(_ expectedId: String) async throws {
        guard try await services.stateService.getActiveAccountId() == expectedId,
              try await services.stateService.isAuthenticated(userId: expectedId)
        else { throw AgentManagementError.accountChanged }
        guard try await !services.authRepository.isLocked(userId: expectedId) else { throw AgentManagementError.locked }
        try Task.checkCancellation()
    }

    private func send<T: Decodable>(path: String, method: HTTPMethod, body: Data? = nil, userId: String) async throws -> T {
        let response = try await sendRaw(path: path, method: method, body: body, userId: userId)
        return try JSONDecoder().decode(T.self, from: response.data)
    }

    private func sendRaw(path: String, method: HTTPMethod, body: Data?, userId: String) async throws -> AgentManagementRequest.Response {
        try await requireAccount(userId)
        let token = try await services.apiService.accountTokenProvider.getToken()
        try await requireAccount(userId)
        // Pin the account token before the request; an account switch cannot retarget this write.
        let response = try await services.apiService.apiUnauthenticatedService.send(
            AgentManagementRequest(path: path, method: method, body: body, token: token),
        )
        try await requireAccount(userId)
        return response
    }

    private func encrypt<T: Encodable>(_ value: T, userId: String) async throws -> String {
        try await requireAccount(userId)
        let json = String(decoding: try JSONEncoder().encode(value), as: UTF8.self)
        // The SDK folder codec seals only its name with the user key; no folder is created or saved.
        let folder = try await services.clientService.vault(for: userId).folders().encrypt(
            folder: FolderView(id: nil, name: json, revisionDate: Date()),
        )
        guard !folder.name.isEmpty else { throw AgentManagementError.invalidPayload }
        return folder.name
    }

    private func decrypt<T: Decodable>(_ encrypted: String, userId: String) async throws -> T {
        let folder = try await services.clientService.vault(for: userId).folders().decrypt(
            folder: Folder(id: nil, name: encrypted, revisionDate: Date()),
        )
        guard !folder.name.isEmpty, let data = folder.name.data(using: .utf8) else { throw AgentManagementError.invalidPayload }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func handle(_ error: Error, fallback: String) {
        switch error {
        case is CancellationError: return
        case AgentManagementError.accountChanged:
            clear()
            message = "Account changed. Open AI agents again for this account."
        case AgentManagementError.locked:
            clear()
            message = "Unlock your vault to manage AI agents."
        case AgentManagementError.nothingSelected:
            message = "Select at least one detail to allow."
        case AgentManagementError.profileRequired:
            message = "Choose a profile for each selected section."
        default: message = fallback
        }
    }

    private struct AnswerBody: Encodable { let revision: Int; let answer: String }
    private struct PairingBody: Encodable { let revision: Int; let revokedAt: String }
    private struct GrantBody: Encodable { let revision: Int; let encryptedGrant: String; let revokedAt: String }
}
