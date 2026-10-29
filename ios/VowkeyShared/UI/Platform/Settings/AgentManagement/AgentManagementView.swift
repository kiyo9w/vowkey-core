import SwiftUI

struct AgentManagementView: View {
    @StateObject var model: AgentManagementModel
    @State private var needsLook = false
    @State private var selectedRequest: String?
    @State private var revokePairing: AgentPairingItem?
    @State private var revokeGrant: AgentGrantItem?

    var body: some View {
        List {
            if let message = model.message { Section { Text(message) } }
            Section("Waiting for you") {
                let waiting = model.requests.filter(\.canAnswer)
                if waiting.isEmpty { Text("No requests waiting").foregroundColor(.secondary) }
                ForEach(waiting) { item in
                    Button { selectedRequest = item.id } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.agentName(pairingId: item.routing.pairingId))
                            Text(item.routing.targetDisplay).font(.subheadline).foregroundColor(.secondary)
                        }
                    }
                }
            }
            Section("Agents") {
                let pairings = model.pairings.filter { $0.row.revokedAt == nil }
                if pairings.isEmpty { Text("Connect an agent from the Vowkey app on the device where it runs.").foregroundColor(.secondary) }
                ForEach(pairings) { item in
                    HStack {
                        Text(item.metadata.displayName)
                        Spacer()
                        Button("Revoke", role: .destructive) { revokePairing = item }.disabled(model.isSaving)
                    }
                }
            }
            Section("Always allowed sites") {
                let grants = model.grants.filter { $0.row.revokedAt == nil }
                if grants.isEmpty { Text("No allowed sites").foregroundColor(.secondary) }
                ForEach(grants) { item in
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.cipherNames[item.payload.cipherId] ?? "Unavailable item")
                            Text(item.payload.destinationKey).font(.subheadline).foregroundColor(.secondary)
                        }
                        Spacer()
                        Button("Revoke", role: .destructive) { revokeGrant = item }.disabled(model.isSaving)
                    }
                }
            }
            Section("Activity") {
                Toggle("Needs a look", isOn: $needsLook)
                let activity = model.activity.filter { !needsLook || $0.needsLook }
                if activity.isEmpty { Text("No activity").foregroundColor(.secondary) }
                ForEach(activity) { item in
                    NavigationLink {
                        List {
                            LabeledContentCompat("Answer", value: item.payload.answer ?? item.statusLabel)
                            LabeledContentCompat("Result", value: item.statusLabel)
                            LabeledContentCompat("Destination", value: item.payload.destinationKey ?? item.payload.host ?? "")
                            if let reference = item.payload.reference { Text(reference).font(.system(.body, design: .monospaced)).textSelection(.enabled) }
                            if let id = item.row.sourceCipherId { LabeledContentCompat("Whose details", value: model.cipherNames[id] ?? "Unavailable item") }
                            if let id = item.payload.pairingId { LabeledContentCompat("AI agent", value: model.agentName(pairingId: id)) }
                        }.navigationTitle("Activity")
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.row.sourceCipherId.flatMap { model.cipherNames[$0] } ?? item.payload.host ?? "AI agent")
                            Text("\(item.payload.destinationKey ?? item.payload.host ?? "") · \(item.statusLabel)").font(.subheadline).foregroundColor(.secondary)
                        }
                    }
                }
                ForEach(model.requests.filter { !$0.canAnswer && $0.row.result == nil }) { item in
                    VStack(alignment: .leading) {
                        Text(item.routing.targetDisplay)
                        Text(item.statusLabel).font(.subheadline).foregroundColor(.secondary)
                    }
                }
            }
        }
        .navigationTitle("AI agents")
        .refreshable { await model.refresh() }
        .task {
            await model.refresh()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if !Task.isCancelled { await model.refresh() }
            }
        }
        .task { await model.observeAccount() }
        .sheet(item: Binding(get: { selectedRequest.map(Selection.init) }, set: { selectedRequest = $0?.id })) { selection in
            NavigationView { AgentAnswerView(model: model, requestId: selection.id) }
        }
        .alert("Revoke this agent?", isPresented: Binding(get: { revokePairing != nil }, set: { if !$0 { revokePairing = nil } })) {
            Button("Revoke", role: .destructive) { if let item = revokePairing { Task { await model.revokePairing(item) } } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("This agent won't be able to make new requests after its device refreshes.") }
        .alert("Revoke this site decision?", isPresented: Binding(get: { revokeGrant != nil }, set: { if !$0 { revokeGrant = nil } })) {
            Button("Revoke", role: .destructive) { if let item = revokeGrant { Task { await model.revokeGrant(item) } } }
            Button("Cancel", role: .cancel) {}
        } message: { Text("The next request for this detail will follow its current rule.") }
    }

    private struct Selection: Identifiable { let id: String }
}

private struct AgentAnswerView: View {
    @ObservedObject var model: AgentManagementModel
    let requestId: String
    @Environment(\.dismiss) private var dismiss
    @State private var selected = Set<String>()
    @State private var profiles: [String: String] = [:]

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { _ in
            if let item = model.requests.first(where: { $0.id == requestId }) {
                Form {
                    Section { Text(item.routing.targetDisplay); Text(item.statusLabel).foregroundColor(.secondary) }
                    if item.canAnswer, let note = item.note {
                        Section("Note from the agent") { Text(note.reason) }
                        Section("Goal") { Text(note.goal) }
                    }
                    ForEach(item.routing.sections) { section in
                        Section(section.label) {
                            if item.routing.needsProfileChoice(sectionId: section.id) {
                                Picker("Whose details", selection: Binding(get: { profiles[section.id] ?? "" }, set: { profiles[section.id] = $0 })) {
                                    Text("Choose a profile").tag("")
                                    ForEach(model.profiles) { Text($0.name).tag($0.id) }
                                }.disabled(!item.canAnswer || model.isSaving)
                            }
                            ForEach(item.routing.entries.filter { $0.sectionId == section.id }) { entry in
                                Toggle(isOn: Binding(get: { selected.contains(entry.id) }, set: { if $0 { selected.insert(entry.id) } else { selected.remove(entry.id) } })) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(entry.label)
                                        if let id = entry.profileId { Text(model.cipherNames[id] ?? "Profile unavailable").font(.subheadline) }
                                        Text("@vk:\(entry.cipherId)/\(entry.fieldPath)").font(.system(.caption, design: .monospaced)).foregroundColor(.secondary)
                                    }
                                }.disabled(!item.canAnswer || model.isSaving)
                            }
                        }
                    }
                    Section("Deadline") { Text(AgentManagementDate.parse(item.row.deadline) ?? Date(), style: .time) }
                    if let message = model.message { Section { Text(message) } }
                    if item.canAnswer {
                        Section {
                            Button("Allow once") { answer(.allowOnce) }
                            Button("Always allow on this site") { answer(.alwaysAllow) }
                            Button("Don't allow", role: .destructive) { answer(.deny) }
                        }.disabled(model.isSaving)
                    }
                }
                .navigationTitle(model.agentName(pairingId: item.routing.pairingId))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
                .onAppear { selected = Set(item.routing.entries.map(\.entryId)) }
            } else { Text("This request is unavailable.") }
        }
    }

    private func answer(_ kind: AgentAnswerKind) {
        Task { if await model.answer(requestId: requestId, kind: kind, selectedEntryIds: selected, sectionProfiles: profiles) { dismiss() } }
    }
}

struct LabeledContentCompat: View {
    let title: String
    let value: String
    init(_ title: String, value: String) { self.title = title; self.value = value }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.caption).foregroundColor(.secondary)
            Text(value).textSelection(.enabled)
        }
    }
}
