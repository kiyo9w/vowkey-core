import CryptoKit
import SwiftUI
import UIKit
import VowkeyKit
import VowkeyResources
import VowkeySdk

// swiftlint:disable file_length

// MARK: - VowkeyItemDetailView

struct VowkeyItemDetailView: View {
    // MARK: Properties

    @ObservedObject var model: VowkeyWorkspaceModel
    let cipherId: String

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.Environment(\.openURL) private var openURL
    @SwiftUI.State private var copiedKey: String?
    @SwiftUI.State private var isEditing = false
    @SwiftUI.State private var isRevealingCardCode = false
    @SwiftUI.State private var isRevealingCardNumber = false
    @SwiftUI.State private var isRevealingSecret = false
    @SwiftUI.State private var isShowingDeleteConfirm = false
    @SwiftUI.State private var totpCode: String?

    private var cipher: CipherView? {
        model.cipher(withId: cipherId)
    }

    // MARK: Body

    var body: some View {
        Group {
            if let current = cipher {
                detailScroll(for: current)
            } else {
                VStack(spacing: 12) {
                    Text("Item unavailable")
                        .styleGuide(.title2, weight: .semibold)
                        .foregroundColor(VowkeyMobileTheme.ink)
                    Button("Back") { dismiss() }
                        .styleGuide(.bodySemibold, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.blue)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
            }
        }
        .navigationBar(
            title: cipher?.name ?? "Item",
            titleDisplayMode: .inline,
        )
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .sheet(isPresented: $isEditing) {
            if let current = cipher {
                VowkeyItemEditorSheet(
                    model: model,
                    initialKind: VowkeyWorkspaceModel.itemKind(for: current),
                    existingCipher: current,
                )
            }
        }
        .confirmationDialog(
            "Move this item to recently deleted?",
            isPresented: $isShowingDeleteConfirm,
            titleVisibility: .visible,
        ) {
            Button("Move to recently deleted", role: .destructive) {
                if let current = cipher {
                    Task {
                        await model.softDelete(current)
                        dismiss()
                    }
                }
            }
            Button(Localizations.cancel, role: .cancel) {}
        }
        .task(id: cipher?.login?.totp) {
            guard let secret = cipher?.login?.totp, !secret.isEmpty else {
                totpCode = nil
                return
            }
            totpCode = Self.computeTOTP(secret: secret)
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                totpCode = Self.computeTOTP(secret: secret)
            }
        }
    }

    // MARK: Private Views

    private func detailScroll(for current: CipherView) -> some View {
        let kind = VowkeyWorkspaceModel.itemKind(for: current)

        return ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VowkeyGroupedCard {
                    HStack(spacing: 14) {
                        VowkeyKindTile(kind: kind, size: 46)
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 6) {
                                Text(current.name)
                                    .styleGuide(.title2, weight: .bold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.ink)
                                    .lineLimit(2)
                                if current.favorite {
                                    SharedAsset.Icons.starFilled24.swiftUIImage
                                        .resizable()
                                        .renderingMode(.template)
                                        .frame(width: 14, height: 14)
                                        .foregroundColor(VowkeyMobileTheme.blue)
                                }
                            }
                            Text(kind.singularTitle)
                                .styleGuide(.callout, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(16)
                }

                switch current.type {
                case .login:
                    loginSection(for: current)
                case .card, .bankAccount:
                    cardSection(for: current)
                case .apiKey, .sshKey:
                    apiKeySection(for: current)
                case .environment:
                    environmentSection(for: current)
                default:
                    noteSection(for: current)
                }

                if let notes = current.notes, !notes.isEmpty, current.type != .secureNote {
                    VStack(alignment: .leading, spacing: 8) {
                        VowkeySectionHeader(Localizations.notes)
                        VowkeyGroupedCard {
                            Text(notes)
                                .styleGuide(.body)
                                .foregroundColor(VowkeyMobileTheme.ink)
                                .textSelection(.enabled)
                                .padding(16)
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 88)
        }
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 14) {
                    Button(Localizations.edit) {
                        isEditing = true
                    }
                    .styleGuide(.bodySemibold, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.blue)

                    Menu {
                        Button {
                            Task { await model.togglePin(current) }
                        } label: {
                            Label(current.favorite ? "Unpin" : "Pin to top", systemImage: current.favorite ? "pin.slash" : "pin")
                        }

                        Divider()

                        Button(role: .destructive) {
                            isShowingDeleteConfirm = true
                        } label: {
                            Label("Move to recently deleted", systemImage: "trash")
                        }
                    } label: {
                        SharedAsset.Icons.ellipsisHorizontal24.swiftUIImage
                            .imageStyle(.accessoryIcon24(color: VowkeyMobileTheme.iconPrimary))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func loginSection(for current: CipherView) -> some View {
        let login = current.login
        VowkeyGroupedCard {
            VStack(spacing: 0) {
                if let username = login?.username, !username.isEmpty {
                    copyableRow(
                        id: "username",
                        label: Localizations.username,
                        value: username,
                        monospaced: false,
                    )
                }

                if let password = login?.password, !password.isEmpty {
                    if login?.username?.isEmpty == false {
                        Divider().padding(.leading, 16)
                    }
                    secretRow(
                        id: "password",
                        label: Localizations.password,
                        value: password,
                        isRevealed: $isRevealingSecret,
                    )
                }

                if let code = totpCode {
                    Divider().padding(.leading, 16)
                    copyableRow(
                        id: "totp",
                        label: "Verification code",
                        value: code,
                        monospaced: true,
                    )
                }

                if let uris = login?.uris?.compactMap(\.uri).filter({ !$0.isEmpty }), !uris.isEmpty {
                    ForEach(Array(uris.enumerated()), id: \.offset) { idx, rawURI in
                        Divider().padding(.leading, 16)
                        HStack(spacing: 10) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Website")
                                    .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.muted)
                                Text(rawURI)
                                    .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.ink)
                                    .lineLimit(1)
                            }
                            Spacer()
                            if let url = Self.normalizedURL(from: rawURI) {
                                Button {
                                    openURL(url)
                                } label: {
                                    SharedAsset.Icons.externalLink16.swiftUIImage
                                        .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.blue))
                                        .frame(width: 32, height: 32)
                                }
                                .buttonStyle(.plain)
                            }
                            copyIconButton(id: "uri_\(idx)", value: rawURI)
                        }
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func cardSection(for current: CipherView) -> some View {
        let card = current.card
        let rule = NativeCipher.agentRule(for: current)
        VStack(alignment: .leading, spacing: 14) {
            VowkeyGroupedCard {
                VStack(spacing: 0) {
                    if let holder = card?.cardholderName, !holder.isEmpty {
                        copyableRow(id: "holder", label: "Cardholder", value: holder, monospaced: false)
                    }
                    if let number = card?.number, !number.isEmpty {
                        if card?.cardholderName?.isEmpty == false {
                            Divider().padding(.leading, 16)
                        }
                        secretRow(
                            id: "card_number",
                            label: "Card number",
                            value: number,
                            isRevealed: $isRevealingCardNumber,
                        )
                    }
                    let expiry = [card?.expMonth, card?.expYear].compactMap(\.self).filter { !$0.isEmpty }.joined(separator: "/")
                    if !expiry.isEmpty {
                        Divider().padding(.leading, 16)
                        copyableRow(id: "card_exp", label: "Expires", value: expiry, monospaced: true)
                    }
                    if let code = card?.code, !code.isEmpty {
                        Divider().padding(.leading, 16)
                        secretRow(
                            id: "card_cvv",
                            label: "Security code",
                            value: code,
                            isRevealed: $isRevealingCardCode,
                        )
                    }
                    if let brand = card?.brand, !brand.isEmpty {
                        Divider().padding(.leading, 16)
                        copyableRow(id: "card_brand", label: "Brand", value: brand, monospaced: false)
                    }
                }
            }

            VStack(alignment: .leading, spacing: 8) {
                VowkeySectionHeader("AI access")
                VowkeyGroupedCard {
                    HStack(spacing: 12) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Form filling & AI agents")
                                .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                            Text("Control whether AI agents and auto-fillers can use this card.")
                                .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                        }
                        Spacer()
                        Menu {
                            ForEach(["fill", "ask", "never"], id: \.self) { option in
                                Button {
                                    Task { await model.setItemAgentRule(current, rule: option) }
                                } label: {
                                    Label(
                                        NativeProfile.humanAgentRuleLabel(option),
                                        systemImage: rule == option ? "checkmark" : "shield",
                                    )
                                }
                            }
                        } label: {
                            let pillShape = RoundedRectangle(cornerRadius: 8, style: .continuous)
                            HStack(spacing: 5) {
                                Text(NativeProfile.humanAgentRuleLabel(rule))
                                    .styleGuide(.callout, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                Image(systemName: "chevron.up.chevron.down")
                                    .font(.caption2.weight(.semibold))
                            }
                            .foregroundColor(rule == "never" ? VowkeyMobileTheme.red : VowkeyMobileTheme.blueInk)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(
                                pillShape.fill(rule == "never" ? VowkeyMobileTheme.redSoft : VowkeyMobileTheme.blueSoft),
                            )
                            .overlay(
                                pillShape.strokeBorder(
                                    rule == "never" ? VowkeyMobileTheme.redBorder : VowkeyMobileTheme.blueSoftBorder,
                                    lineWidth: 1,
                                ),
                            )
                        }
                        .accessibilityIdentifier("CardAgentRuleMenu")
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 13)
                }
            }
        }
    }

    @ViewBuilder
    private func apiKeySection(for current: CipherView) -> some View {
        let handle = "@vk:\(current.id ?? "item")/key.value"
        let apiKey = current.apiKey

        VStack(alignment: .leading, spacing: 14) {
            VowkeyGroupedCard {
                VStack(spacing: 0) {
                    copyableRow(
                        id: "vk_handle",
                        label: "Agent handle (safe for scripts & prompts)",
                        value: handle,
                        monospaced: true,
                    )
                    if let apiKey {
                        Divider().padding(.leading, 16)
                        secretRow(
                            id: "api_secret",
                            label: "API key value",
                            value: apiKey.value ?? "",
                            isRevealed: $isRevealingSecret,
                        )
                        Divider().padding(.leading, 16)
                        copyableRow(
                            id: "send_style",
                            label: "Delivery",
                            value: (apiKey.sendStyle ?? "bearer").capitalized,
                            monospaced: false,
                        )
                        if !apiKey.allowedHosts.isEmpty {
                            Divider().padding(.leading, 16)
                            copyableRow(
                                id: "allowed_hosts",
                                label: "Allowed hosts",
                                value: apiKey.allowedHosts.joined(separator: ", "),
                                monospaced: true,
                            )
                        }
                        if let header = apiKey.headerName, !header.isEmpty {
                            Divider().padding(.leading, 16)
                            copyableRow(id: "header_name", label: "Header name", value: header, monospaced: true)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func environmentSection(for current: CipherView) -> some View {
        let members = current.environment?.members ?? []
        let envLines = members.map { "\($0.name)=@vk:\($0.itemId)/key.value" }.joined(separator: "\n")

        VStack(alignment: .leading, spacing: 12) {
            VowkeyGroupedCard {
                VStack(spacing: 0) {
                    if members.isEmpty {
                        Text("No environment bindings yet")
                            .styleGuide(.body)
                            .foregroundColor(VowkeyMobileTheme.muted)
                            .padding(16)
                    } else {
                        ForEach(Array(members.enumerated()), id: \.offset) { idx, member in
                            let keyName = model.cipher(withId: member.itemId)?.name ?? member.itemId
                            copyableRow(
                                id: "env_\(idx)",
                                label: "\(member.name) · \(keyName)",
                                value: "\(member.name)=@vk:\(member.itemId)/key.value",
                                monospaced: true,
                            )
                            if idx < members.count - 1 {
                                Divider().padding(.leading, 16)
                            }
                        }
                    }
                }
            }

            if !envLines.isEmpty {
                Button {
                    copyText(envLines, key: "env_all")
                } label: {
                    Text(copiedKey == "env_all" ? VowkeyMobileTheme.copiedText : "Copy .env block")
                }
                .buttonStyle(.secondary(size: .medium))
            }
        }
    }

    @ViewBuilder
    private func noteSection(for current: CipherView) -> some View {
        let bodyText = current.notes ?? ""
        VowkeyGroupedCard {
            VStack(alignment: .leading, spacing: 12) {
                Text(bodyText.isEmpty ? "Empty note" : bodyText)
                    .styleGuide(.body)
                    .foregroundColor(bodyText.isEmpty ? VowkeyMobileTheme.muted : VowkeyMobileTheme.ink)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)

                if !bodyText.isEmpty {
                    HStack {
                        Spacer()
                        Button {
                            copyText(bodyText, key: "note_body")
                        } label: {
                            HStack(spacing: 5) {
                                (copiedKey == "note_body" ? SharedAsset.Icons.check16 : SharedAsset.Icons.copy16)
                                    .swiftUIImage
                                    .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.blue))
                                Text(copiedKey == "note_body" ? VowkeyMobileTheme.copiedText : Localizations.copy)
                                    .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.blue)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(16)
        }
    }

    private func copyableRow(id: String, label: String, value: String, monospaced: Bool) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(label)
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                    if copiedKey == id {
                        Text(VowkeyMobileTheme.copiedText)
                            .styleGuide(.caption2, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.green)
                    }
                }
                if monospaced {
                    Text(value)
                        .styleGuide(.sensitiveInfoSmall, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.ink)
                        .lineLimit(2)
                } else {
                    Text(value)
                        .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.ink)
                        .lineLimit(2)
                }
            }
            Spacer()
            copyIconButton(id: id, value: value)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
        .onTapGesture {
            copyText(value, key: id)
        }
    }

    private func secretRow(
        id: String,
        label: String,
        value: String,
        isRevealed: Binding<Bool>,
    ) -> some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(label)
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                    if copiedKey == id {
                        Text(VowkeyMobileTheme.copiedText)
                            .styleGuide(.caption2, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.green)
                    }
                }
                Text(isRevealed.wrappedValue ? value : String(repeating: "•", count: min(max(value.count, 10), 16)))
                    .styleGuide(.sensitiveInfoSmall, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.ink)
                    .lineLimit(2)
            }
            Spacer()
            Button {
                isRevealed.wrappedValue.toggle()
            } label: {
                (isRevealed.wrappedValue ? SharedAsset.Icons.eyeSlash24 : SharedAsset.Icons.eye24)
                    .swiftUIImage
                    .resizable()
                    .renderingMode(.template)
                    .frame(width: 18, height: 18)
                    .foregroundColor(VowkeyMobileTheme.muted)
                    .frame(width: 30, height: 30)
            }
            .buttonStyle(.plain)
            copyIconButton(id: id, value: value)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func copyIconButton(id: String, value: String) -> some View {
        Button {
            copyText(value, key: id)
        } label: {
            (copiedKey == id ? SharedAsset.Icons.check16 : SharedAsset.Icons.copy16)
                .swiftUIImage
                .imageStyle(
                    .accessoryIcon16(
                        color: copiedKey == id ? VowkeyMobileTheme.green : VowkeyMobileTheme.blue,
                    ),
                )
                .frame(width: 30, height: 30)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Localizations.copy)
    }

    private func copyText(_ text: String, key: String) {
        UIPasteboard.general.string = text
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        copiedKey = key
        Task {
            try? await Task.sleep(nanoseconds: 1_400_000_000)
            if copiedKey == key {
                copiedKey = nil
            }
        }
    }

    private static func normalizedURL(from raw: String) -> URL? {
        if let direct = URL(string: raw), direct.scheme != nil {
            return direct
        }
        return URL(string: "https://\(raw)")
    }

    private static func computeTOTP(secret: String, date: Date = Date()) -> String? {
        let cleaned = secret
            .uppercased()
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: "-", with: "")
        guard let keyData = base32Decode(cleaned), !keyData.isEmpty else { return nil }
        let counter = UInt64(date.timeIntervalSince1970) / 30
        var bigEndianCounter = counter.bigEndian
        let counterData = Data(bytes: &bigEndianCounter, count: MemoryLayout<UInt64>.size)
        let mac = HMAC<Insecure.SHA1>.authenticationCode(for: counterData, using: SymmetricKey(data: keyData))
        let bytes = Array(mac)
        let offset = Int(bytes[bytes.count - 1] & 0x0F)
        let truncated = (UInt32(bytes[offset] & 0x7F) << 24)
            | (UInt32(bytes[offset + 1]) << 16)
            | (UInt32(bytes[offset + 2]) << 8)
            | UInt32(bytes[offset + 3])
        let digits = truncated % 1_000_000
        let raw = String(format: "%06d", digits)
        return String(raw.prefix(3)) + " " + String(raw.suffix(3))
    }

    private static func base32Decode(_ input: String) -> Data? {
        let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")
        var buffer: UInt32 = 0
        var bitsLeft = 0
        var out = Data()
        for char in input where char != "=" {
            guard let val = alphabet.firstIndex(of: char) else { return nil }
            buffer = (buffer << 5) | UInt32(val)
            bitsLeft += 5
            if bitsLeft >= 8 {
                bitsLeft -= 8
                out.append(UInt8((buffer >> bitsLeft) & 0xFF))
            }
        }
        return out
    }
}

// MARK: - VowkeyItemEditorSheet

struct VowkeyItemEditorSheet: View {
    @ObservedObject var model: VowkeyWorkspaceModel
    let initialKind: VowkeyItemKind
    let existingCipher: CipherView?

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var allowedHosts: String
    @SwiftUI.State private var apiSecret: String
    @SwiftUI.State private var basicUsername: String
    @SwiftUI.State private var cardBrand: String
    @SwiftUI.State private var cardCode: String
    @SwiftUI.State private var cardExpMonth: String
    @SwiftUI.State private var cardExpYear: String
    @SwiftUI.State private var cardHolder: String
    @SwiftUI.State private var cardNumber: String
    @SwiftUI.State private var envKeyId: String
    @SwiftUI.State private var envVarName: String
    @SwiftUI.State private var errorMessage: String?
    @SwiftUI.State private var headerName: String
    @SwiftUI.State private var isShowingGenerator = false
    @SwiftUI.State private var kind: VowkeyItemKind
    @SwiftUI.State private var loginPassword: String
    @SwiftUI.State private var loginTotp: String
    @SwiftUI.State private var loginURI: String
    @SwiftUI.State private var loginUsername: String
    @SwiftUI.State private var notes: String
    @SwiftUI.State private var profileFirstLabel = "Full name"
    @SwiftUI.State private var profileFirstValue = ""
    @SwiftUI.State private var profileSecondLabel = "Email"
    @SwiftUI.State private var profileSecondValue = ""
    @SwiftUI.State private var sendStyle: String
    @SwiftUI.State private var title: String

    init(
        model: VowkeyWorkspaceModel,
        initialKind: VowkeyItemKind = .login,
        existingCipher: CipherView? = nil,
    ) {
        self.model = model
        self.initialKind = initialKind
        self.existingCipher = existingCipher

        _kind = SwiftUI.State(initialValue: initialKind)
        _title = SwiftUI.State(initialValue: existingCipher?.name ?? "")
        _notes = SwiftUI.State(initialValue: existingCipher?.notes ?? "")
        _loginUsername = SwiftUI.State(initialValue: existingCipher?.login?.username ?? "")
        _loginPassword = SwiftUI.State(initialValue: existingCipher?.login?.password ?? "")
        _loginURI = SwiftUI.State(initialValue: existingCipher?.login?.uris?.first?.uri ?? "")
        _loginTotp = SwiftUI.State(initialValue: existingCipher?.login?.totp ?? "")
        _cardHolder = SwiftUI.State(initialValue: existingCipher?.card?.cardholderName ?? "")
        _cardNumber = SwiftUI.State(initialValue: existingCipher?.card?.number ?? "")
        _cardExpMonth = SwiftUI.State(initialValue: existingCipher?.card?.expMonth ?? "")
        _cardExpYear = SwiftUI.State(initialValue: existingCipher?.card?.expYear ?? "")
        _cardCode = SwiftUI.State(initialValue: existingCipher?.card?.code ?? "")
        _cardBrand = SwiftUI.State(initialValue: existingCipher?.card?.brand ?? "Visa")
        _apiSecret = SwiftUI.State(initialValue: existingCipher?.apiKey?.value ?? "")
        _sendStyle = SwiftUI.State(initialValue: existingCipher?.apiKey?.sendStyle ?? "bearer")
        _allowedHosts = SwiftUI.State(initialValue: existingCipher?.apiKey?.allowedHosts.joined(separator: ", ") ?? "")
        _headerName = SwiftUI.State(initialValue: existingCipher?.apiKey?.headerName ?? "")
        _basicUsername = SwiftUI.State(initialValue: existingCipher?.apiKey?.basicUsername ?? "")
        _envVarName = SwiftUI.State(initialValue: existingCipher?.environment?.members.first?.name ?? "OPENAI_API_KEY")
        _envKeyId = SwiftUI.State(
            initialValue: existingCipher?.environment?.members.first?.itemId ?? model.apiKeys.first?.id ?? "",
        )
    }

    var body: some View {
        NavigationView {
            Form {
                if existingCipher == nil {
                    Section("Item kind") {
                        Picker("Kind", selection: $kind) {
                            Text("Profile").tag(VowkeyItemKind.profile)
                            Text("Login").tag(VowkeyItemKind.login)
                            Text("Card").tag(VowkeyItemKind.card)
                            Text("API key").tag(VowkeyItemKind.key)
                            Text("Note").tag(VowkeyItemKind.note)
                        }
                    }
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage)
                            .styleGuide(.callout)
                            .foregroundColor(VowkeyMobileTheme.red)
                    }
                }

                Section("Title") {
                    TextField(titlePlaceholder, text: $title)
                        .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                        .accessibilityIdentifier("ItemEditorTitleField")
                }

                switch kind {
                case .profile:
                    profileFormSection
                case .login:
                    loginFormSection
                case .card:
                    cardFormSection
                case .key:
                    apiKeyFormSection
                case .environment:
                    environmentFormSection
                default:
                    noteFormSection
                }
            }
            .navigationBar(
                title: existingCipher == nil ? "New \(kind.singularTitle.lowercased())" : "Edit \(kind.singularTitle.lowercased())",
                titleDisplayMode: .inline,
            )
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Localizations.cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.save) {
                        Task { await saveEntry() }
                    }
                    .styleGuide(.bodySemibold, includeLinePadding: false, includeLineSpacing: false)
                    .accessibilityIdentifier("ItemEditorSaveButton")
                }
            }
            .sheet(isPresented: $isShowingGenerator) {
                VowkeyGeneratorSheet { generated in
                    loginPassword = generated
                }
            }
        }
    }

    private var titlePlaceholder: String {
        switch kind {
        case .profile:
            "Person's name (e.g. Linh Nguyen)"
        case .login:
            "Service or website (e.g. GitHub)"
        case .card:
            "Card nickname (e.g. Travel Visa)"
        case .key:
            "Key name (e.g. OpenAI production)"
        case .environment:
            "Environment name (e.g. Local dev)"
        default:
            "Note title"
        }
    }

    private var profileFormSection: some View {
        Section("Initial details") {
            TextField("First detail label", text: $profileFirstLabel)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
            TextField("First detail value", text: $profileFirstValue)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
            TextField("Second detail label (optional)", text: $profileSecondLabel)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
            TextField("Second detail value (optional)", text: $profileSecondValue)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
        }
    }

    private var loginFormSection: some View {
        Group {
            Section("Credentials") {
                TextField(Localizations.username, text: $loginUsername)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("ItemEditorUsernameField")

                HStack {
                    SecureField(Localizations.password, text: $loginPassword)
                        .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityIdentifier("ItemEditorPasswordField")
                    Button {
                        isShowingGenerator = true
                    } label: {
                        HStack(spacing: 4) {
                            SharedAsset.Icons.generate16.swiftUIImage
                                .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.blue))
                            Text("Generate")
                                .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.blue)
                        }
                    }
                    .buttonStyle(.borderless)
                    .accessibilityIdentifier("ItemEditorOpenGeneratorButton")
                }

                TextField("Website URL (optional)", text: $loginURI)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    .autocorrectionDisabled()

                TextField("Authenticator key / TOTP (optional)", text: $loginTotp)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            Section(Localizations.notes) {
                TextEditor(text: $notes)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .frame(minHeight: 72)
            }
        }
    }

    private var cardFormSection: some View {
        Section("Card details") {
            TextField("Cardholder name", text: $cardHolder)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
            TextField("Card number", text: $cardNumber)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                .keyboardType(.numberPad)
            HStack {
                TextField("MM", text: $cardExpMonth)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .keyboardType(.numberPad)
                TextField("YYYY", text: $cardExpYear)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .keyboardType(.numberPad)
                SecureField("CVV", text: $cardCode)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .keyboardType(.numberPad)
            }
            TextField("Brand (e.g. Visa, Mastercard)", text: $cardBrand)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
        }
    }

    private var apiKeyFormSection: some View {
        Section("API key") {
            SecureField("Secret key value", text: $apiSecret)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("ItemEditorApiSecretField")

            Picker("Delivery", selection: $sendStyle) {
                Text("Bearer header").tag("bearer")
                Text("Custom header").tag("header")
                Text("Basic auth").tag("basic")
            }

            if sendStyle == "header" {
                TextField("Header name (e.g. X-API-Key)", text: $headerName)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            } else if sendStyle == "basic" {
                TextField("Basic auth username", text: $basicUsername)
                    .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
            }

            TextField("Allowed hosts (e.g. api.openai.com)", text: $allowedHosts)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .accessibilityIdentifier("ItemEditorAllowedHostsField")
        }
    }

    private var environmentFormSection: some View {
        Section("Environment binding") {
            TextField("Variable name (e.g. OPENAI_API_KEY)", text: $envVarName)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()

            if model.apiKeys.isEmpty {
                Text("Save an API key first to bind it to an environment variable.")
                    .styleGuide(.callout)
                    .foregroundColor(VowkeyMobileTheme.muted)
            } else {
                Picker("Saved API key", selection: $envKeyId) {
                    ForEach(model.apiKeys, id: \.id) { item in
                        Text(item.name).tag(item.id ?? "")
                    }
                }
            }
        }
    }

    private var noteFormSection: some View {
        Section(Localizations.notes) {
            TextEditor(text: $notes)
                .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                .frame(minHeight: 140)
        }
    }

    private func saveEntry() async {
        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            errorMessage = "Enter a title first."
            return
        }

        switch kind {
        case .profile:
            var rows: [(String, String)] = []
            if !profileFirstValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                rows.append((profileFirstLabel, profileFirstValue))
            } else {
                rows.append(("Full name", trimmedTitle))
            }
            if !profileSecondValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                rows.append((profileSecondLabel, profileSecondValue))
            }
            if await model.addProfile(name: trimmedTitle, initialDetails: rows) != nil {
                dismiss()
            }
        case .login:
            let base = existingCipher ?? NativeCipher.make(type: .login, name: trimmedTitle)
            let uris: [LoginUriView]? = loginURI.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ? nil
                : [LoginUriView(uri: loginURI.trimmingCharacters(in: .whitespacesAndNewlines), match: nil, uriChecksum: nil)]
            let updated = NativeCipher.replacing(
                base,
                name: trimmedTitle,
                notes: notes.isEmpty ? nil : notes,
                login: VowkeySdk.LoginView(
                    username: loginUsername.isEmpty ? nil : loginUsername,
                    password: loginPassword.isEmpty ? nil : loginPassword,
                    passwordRevisionDate: nil,
                    uris: uris,
                    totp: loginTotp.isEmpty ? nil : loginTotp,
                    autofillOnPageLoad: nil,
                    fido2Credentials: existingCipher?.login?.fido2Credentials,
                ),
            )
            if await model.saveCipher(updated) != nil {
                dismiss()
            }
        case .card:
            let base = existingCipher ?? NativeCipher.make(type: .card, name: trimmedTitle)
            let updated = NativeCipher.replacing(
                base,
                name: trimmedTitle,
                notes: notes.isEmpty ? nil : notes,
                card: VowkeySdk.CardView(
                    cardholderName: cardHolder.isEmpty ? nil : cardHolder,
                    expMonth: cardExpMonth.isEmpty ? nil : cardExpMonth,
                    expYear: cardExpYear.isEmpty ? nil : cardExpYear,
                    code: cardCode.isEmpty ? nil : cardCode,
                    brand: cardBrand.isEmpty ? nil : cardBrand,
                    number: cardNumber.isEmpty ? nil : cardNumber,
                ),
            )
            if await model.saveCipher(updated) != nil {
                dismiss()
            }
        case .key:
            do {
                let hosts = allowedHosts
                    .split { $0.isWhitespace || $0 == "," }
                    .map(String.init)
                    .filter { !$0.isEmpty }
                let keyView = ApiKeyView(
                    value: apiSecret,
                    sendStyle: sendStyle,
                    allowedHosts: hosts,
                    headerName: headerName.isEmpty ? nil : headerName,
                    basicUsername: basicUsername.isEmpty ? nil : basicUsername,
                )
                try NativeCipher.validate(name: trimmedTitle, key: keyView, environment: nil, keys: [])
                let base = existingCipher ?? NativeCipher.make(type: .apiKey, name: trimmedTitle)
                let updated = NativeCipher.replacing(base, name: trimmedTitle, apiKey: keyView)
                if await model.saveCipher(updated) != nil {
                    dismiss()
                }
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        case .environment:
            do {
                let chosenKeyId = envKeyId.isEmpty ? (model.apiKeys.first?.id ?? "") : envKeyId
                let envView = EnvironmentView(members: [EnvironmentMember(name: envVarName, itemId: chosenKeyId)])
                try NativeCipher.validate(
                    name: trimmedTitle,
                    key: nil,
                    environment: envView,
                    keys: Set(model.apiKeys.compactMap(\.id)),
                )
                let base = existingCipher ?? NativeCipher.make(type: .environment, name: trimmedTitle)
                let updated = NativeCipher.replacing(base, name: trimmedTitle, environment: envView)
                if await model.saveCipher(updated) != nil {
                    dismiss()
                }
            } catch {
                errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        default:
            let base = existingCipher ?? NativeCipher.make(type: .secureNote, name: trimmedTitle)
            let updated = NativeCipher.replacing(
                base,
                name: trimmedTitle,
                notes: notes,
                secureNote: SecureNoteView(type: .generic),
            )
            if await model.saveCipher(updated) != nil {
                dismiss()
            }
        }
    }
}

// MARK: - VowkeyGeneratorSheet

struct VowkeyGeneratorSheet: View {
    var onSelectPassword: ((String) -> Void)?

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var copied = false
    @SwiftUI.State private var generatedValue = ""
    @SwiftUI.State private var includeDigits = true
    @SwiftUI.State private var includeLowercase = true
    @SwiftUI.State private var includeSymbols = true
    @SwiftUI.State private var includeUppercase = true
    @SwiftUI.State private var length: Double = 20
    @SwiftUI.State private var mode: VowkeyGeneratorMode = .password
    @SwiftUI.State private var pinLength: Double = 6
    @SwiftUI.State private var wordCount: Double = 4

    var body: some View {
        NavigationView {
            List {
                Section {
                    Picker("Type", selection: $mode) {
                        ForEach(VowkeyGeneratorMode.allCases) { item in
                            Text(item.title).tag(item)
                        }
                    }
                    .pickerStyle(.segmented)

                    generatorPreviewBlock
                }

                generatorOptionsSection
            }
            .navigationBar(title: "Password & PIN generator", titleDisplayMode: .inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.close) { dismiss() }
                        .foregroundColor(VowkeyMobileTheme.blue)
                }
            }
            .onAppear { regenerate() }
            .onChange(of: mode) { _ in regenerate() }
            .onChange(of: length) { _ in regenerate() }
            .onChange(of: includeUppercase) { _ in regenerate() }
            .onChange(of: includeLowercase) { _ in regenerate() }
            .onChange(of: includeDigits) { _ in regenerate() }
            .onChange(of: includeSymbols) { _ in regenerate() }
            .onChange(of: wordCount) { _ in regenerate() }
            .onChange(of: pinLength) { _ in regenerate() }
        }
    }

    private var generatorPreviewBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(generatedValue)
                .styleGuide(.sensitiveInfoSmall, includeLinePadding: false, includeLineSpacing: false)
                .foregroundColor(VowkeyMobileTheme.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)

            HStack(spacing: 10) {
                Button(action: regenerate) {
                    HStack(spacing: 5) {
                        SharedAsset.Icons.restartFilled24.swiftUIImage
                            .resizable()
                            .renderingMode(.template)
                            .frame(width: 14, height: 14)
                        Text("New value")
                            .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                    }
                    .foregroundColor(VowkeyMobileTheme.ink)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(VowkeyMobileTheme.chipFill))
                    .overlay(Capsule().strokeBorder(VowkeyMobileTheme.line, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Button {
                    UIPasteboard.general.string = generatedValue
                    copied = true
                } label: {
                    HStack(spacing: 5) {
                        (copied ? SharedAsset.Icons.check16 : SharedAsset.Icons.copy16)
                            .swiftUIImage
                            .resizable()
                            .renderingMode(.template)
                            .frame(width: 14, height: 14)
                        Text(copied ? VowkeyMobileTheme.copiedText : Localizations.copy)
                            .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                    }
                    .foregroundColor(VowkeyMobileTheme.blueInk)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(VowkeyMobileTheme.blueSoft))
                    .overlay(Capsule().strokeBorder(VowkeyMobileTheme.blueSoftBorder, lineWidth: 1))
                }
                .buttonStyle(.plain)

                Spacer()

                if let onSelectPassword {
                    Button("Use") {
                        onSelectPassword(generatedValue)
                        dismiss()
                    }
                    .buttonStyle(.primary(shouldFillWidth: false, size: .small))
                    .accessibilityIdentifier("GeneratorUseButton")
                }
            }
        }
    }

    @ViewBuilder
    private var generatorOptionsSection: some View {
        switch mode {
        case .password:
            Section("Options") {
                Stepper("Length: \(Int(length))", value: $length, in: 8 ... 64)
                Toggle("Uppercase (A–Z)", isOn: $includeUppercase)
                Toggle("Lowercase (a–z)", isOn: $includeLowercase)
                Toggle("Numbers (0–9)", isOn: $includeDigits)
                Toggle("Symbols (!@#$)", isOn: $includeSymbols)
            }
        case .passphrase:
            Section("Options") {
                Stepper("Words: \(Int(wordCount))", value: $wordCount, in: 3 ... 8)
            }
        case .pin:
            Section("Options") {
                Stepper("Digits: \(Int(pinLength))", value: $pinLength, in: 4 ... 12)
            }
        }
    }

    private func regenerate() {
        copied = false
        generatedValue = VowkeySecretGenerator.generate(
            mode: mode,
            length: Int(length),
            includeUppercase: includeUppercase,
            includeLowercase: includeLowercase,
            includeDigits: includeDigits,
            includeSymbols: includeSymbols,
            wordCount: Int(wordCount),
            pinLength: Int(pinLength),
        )
    }
}
