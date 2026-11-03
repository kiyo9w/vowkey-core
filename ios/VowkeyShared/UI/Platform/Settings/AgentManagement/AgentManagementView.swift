import SwiftUI
import VowkeyResources

// MARK: - AgentManagementView

/// Screen managing paired AI agents, pending requests, site rules, and activity.
struct AgentManagementView: View {
    @StateObject var model: AgentManagementModel
    @SwiftUI.State private var needsLook = false
    @SwiftUI.State private var selectedRequest: String?
    @SwiftUI.State private var revokePairing: AgentPairingItem?
    @SwiftUI.State private var revokeGrant: AgentGrantItem?

    var body: some View {
        List {
            if let message = model.message {
                Section {
                    HStack(spacing: 10) {
                        Image(systemName: "info.circle.fill")
                            .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                        Text(message)
                            .font(.subheadline)
                            .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                    }
                }
            }

            Section("Waiting for you") {
                let waiting = model.requests.filter(\.canAnswer)
                if waiting.isEmpty {
                    emptyRow(icon: "checkmark.circle", text: "No requests waiting")
                } else {
                    ForEach(waiting) { item in
                        Button {
                            selectedRequest = item.id
                        } label: {
                            HStack(spacing: 12) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .fill(SharedAsset.Colors.tintPrimary.swiftUIColor.opacity(0.12))
                                        .frame(width: 34, height: 34)
                                    Image(systemName: "clock.badge.exclamationmark")
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                                }
                                VStack(alignment: .leading, spacing: 3) {
                                    Text(model.agentName(pairingId: item.routing.pairingId))
                                        .font(.subheadline.weight(.semibold))
                                        .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                                    Text(item.routing.targetDisplay)
                                        .font(.caption)
                                        .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }

            Section("Agents") {
                let pairings = model.pairings.filter { $0.row.revokedAt == nil }
                if pairings.isEmpty {
                    emptyRow(
                        icon: "cpu",
                        text: "Connect an agent from the Vowkey app on the device where it runs.",
                    )
                } else {
                    ForEach(pairings) { item in
                        HStack(spacing: 12) {
                            Image(systemName: "cpu")
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                                .frame(width: 24)
                            Text(item.metadata.displayName)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                            Spacer()
                            Button("Revoke", role: .destructive) {
                                revokePairing = item
                            }
                            .font(.subheadline)
                            .disabled(model.isSaving)
                        }
                    }
                }
            }

            Section("Always allowed sites") {
                let grants = model.grants.filter { $0.row.revokedAt == nil }
                if grants.isEmpty {
                    emptyRow(icon: "checkmark.shield", text: "No allowed sites")
                } else {
                    ForEach(grants) { item in
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(model.cipherNames[item.payload.cipherId] ?? "Unavailable item")
                                    .font(.subheadline.weight(.medium))
                                    .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                                Text(item.payload.destinationKey)
                                    .font(.caption.monospaced())
                                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                            }
                            Spacer()
                            Button("Revoke", role: .destructive) {
                                revokeGrant = item
                            }
                            .font(.subheadline)
                            .disabled(model.isSaving)
                        }
                    }
                }
            }

            Section("Activity") {
                Toggle("Needs a look", isOn: $needsLook)
                    .tint(SharedAsset.Colors.tintPrimary.swiftUIColor)
                let activity = model.activity.filter { !needsLook || $0.needsLook }
                if activity.isEmpty {
                    emptyRow(icon: "list.bullet.rectangle", text: "No activity")
                } else {
                    ForEach(activity) { item in
                        NavigationLink {
                            List {
                                LabeledContentCompat("Answer", value: item.payload.answer ?? item.statusLabel)
                                LabeledContentCompat("Result", value: item.statusLabel)
                                LabeledContentCompat(
                                    "Destination",
                                    value: item.payload.destinationKey ?? item.payload.host ?? "",
                                )
                                if let reference = item.payload.reference {
                                    Text(reference)
                                        .font(.footnote.monospaced())
                                        .textSelection(.enabled)
                                }
                                if let id = item.row.sourceCipherId {
                                    LabeledContentCompat(
                                        "Whose details",
                                        value: model.cipherNames[id] ?? "Unavailable item",
                                    )
                                }
                                if let id = item.payload.pairingId {
                                    LabeledContentCompat("AI agent", value: model.agentName(pairingId: id))
                                }
                            }
                            .listStyle(.insetGrouped)
                            .modifier(PaperListBackgroundModifier())
                            .navigationTitle("Activity")
                        } label: {
                            VStack(alignment: .leading, spacing: 3) {
                                Text(
                                    item.row.sourceCipherId.flatMap { model.cipherNames[$0] }
                                        ?? item.payload.host
                                        ?? "AI agent",
                                )
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(SharedAsset.Colors.textPrimary.swiftUIColor)
                                Text("\(item.payload.destinationKey ?? item.payload.host ?? "") · \(item.statusLabel)")
                                    .font(.caption)
                                    .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                            }
                        }
                    }
                }
                ForEach(model.requests.filter { !$0.canAnswer && $0.row.result == nil }) { item in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(item.routing.targetDisplay)
                            .font(.subheadline)
                        Text(item.statusLabel)
                            .font(.caption)
                            .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .modifier(PaperListBackgroundModifier())
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
        .sheet(
            item: Binding(
                get: { selectedRequest.map(Selection.init) },
                set: { selectedRequest = $0?.id },
            ),
        ) { selection in
            NavigationView { AgentAnswerView(model: model, requestId: selection.id) }
        }
        .alert(
            "Revoke this agent?",
            isPresented: Binding(get: { revokePairing != nil }, set: { if !$0 { revokePairing = nil } }),
        ) {
            Button("Revoke", role: .destructive) {
                if let item = revokePairing { Task { await model.revokePairing(item) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This agent won't be able to make new requests after its device refreshes.")
        }
        .alert(
            "Revoke this site decision?",
            isPresented: Binding(get: { revokeGrant != nil }, set: { if !$0 { revokeGrant = nil } }),
        ) {
            Button("Revoke", role: .destructive) {
                if let item = revokeGrant { Task { await model.revokeGrant(item) } }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("The next request for this detail will follow its current rule.")
        }
    }

    private struct Selection: Identifiable { let id: String }

    @ViewBuilder
    private func emptyRow(icon: String, text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.subheadline)
                .foregroundStyle(SharedAsset.Colors.iconPrimary.swiftUIColor)
                .frame(width: 22)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
        }
        .padding(.vertical, 2)
    }
}

// MARK: - AgentAnswerView

private struct AgentAnswerView: View {
    @ObservedObject var model: AgentManagementModel
    let requestId: String
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var selected = Set<String>()
    @SwiftUI.State private var profiles: [String: String] = [:]

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { _ in
            if let item = model.requests.first(where: { $0.id == requestId }) {
                Form {
                    Section {
                        Text(item.routing.targetDisplay)
                            .font(.subheadline.weight(.semibold))
                        Text(item.statusLabel)
                            .font(.caption)
                            .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
                    }
                    if item.canAnswer, let note = item.note {
                        Section("Note from the agent") { Text(note.reason) }
                        Section("Goal") { Text(note.goal) }
                    }
                    ForEach(item.routing.sections) { section in
                        Section(section.label) {
                            if item.routing.needsProfileChoice(sectionId: section.id) {
                                Picker(
                                    "Whose details",
                                    selection: Binding(
                                        get: { profiles[section.id] ?? "" },
                                        set: { profiles[section.id] = $0 },
                                    ),
                                ) {
                                    Text("Choose a profile").tag("")
                                    ForEach(model.profiles) { Text($0.name).tag($0.id) }
                                }
                                .disabled(!item.canAnswer || model.isSaving)
                            }
                            ForEach(item.routing.entries.filter { $0.sectionId == section.id }) { entry in
                                Toggle(
                                    isOn: Binding(
                                        get: { selected.contains(entry.id) },
                                        set: {
                                            if $0 { selected.insert(entry.id) } else { selected.remove(entry.id) }
                                        },
                                    ),
                                ) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(entry.label)
                                            .font(.subheadline.weight(.medium))
                                        if let id = entry.profileId {
                                            Text(model.cipherNames[id] ?? "Profile unavailable")
                                                .font(.caption)
                                        }
                                        Text("@vk:\(entry.cipherId)/\(entry.fieldPath)")
                                            .font(.caption.monospaced())
                                            .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                                    }
                                }
                                .tint(SharedAsset.Colors.tintPrimary.swiftUIColor)
                                .disabled(!item.canAnswer || model.isSaving)
                            }
                        }
                    }
                    Section("Deadline") {
                        Text(AgentManagementDate.parse(item.row.deadline) ?? Date(), style: .time)
                    }
                    if let message = model.message { Section { Text(message) } }
                    if item.canAnswer {
                        Section {
                            Button {
                                answer(.allowOnce)
                            } label: {
                                Text("Allow once").fontWeight(.semibold)
                            }
                            .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                            Button("Always allow on this site") { answer(.alwaysAllow) }
                                .foregroundStyle(SharedAsset.Colors.tintPrimary.swiftUIColor)
                            Button("Don't allow", role: .destructive) { answer(.deny) }
                        }
                        .disabled(model.isSaving)
                    }
                }
                .modifier(PaperListBackgroundModifier())
                .navigationTitle(model.agentName(pairingId: item.routing.pairingId))
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Close") { dismiss() }
                    }
                }
                .onAppear { selected = Set(item.routing.entries.map(\.entryId)) }
            } else {
                Text("This request is unavailable.")
            }
        }
    }

    private func answer(_ kind: AgentAnswerKind) {
        Task {
            if await model.answer(
                requestId: requestId,
                kind: kind,
                selectedEntryIds: selected,
                sectionProfiles: profiles,
            ) {
                dismiss()
            }
        }
    }
}

// MARK: - LabeledContentCompat

/// Compatibility key-value row for iOS 15+.
struct LabeledContentCompat: View {
    let title: String
    let value: String

    init(_ title: String, value: String) {
        self.title = title
        self.value = value
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.caption)
                .foregroundStyle(SharedAsset.Colors.textSecondary.swiftUIColor)
            Text(value)
                .textSelection(.enabled)
        }
    }
}
