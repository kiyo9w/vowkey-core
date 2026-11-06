import Combine
import Foundation
import PDFKit
import Security
import SwiftUI
import UIKit
import VisionKit
import VowkeyKit
import VowkeyResources
import VowkeySdk

// swiftlint:disable file_length

// MARK: - VowkeyWorkspaceModel

@MainActor
final class VowkeyWorkspaceModel: ObservableObject {
    // MARK: Types

    typealias WorkspaceServices = HasAPIService
        & HasAuthRepository
        & HasCameraService
        & HasCipherService
        & HasClientService
        & HasEnvironmentService
        & HasStateService
        & HasSyncService
        & HasVaultRepository

    // MARK: Properties

    @Published private(set) var accountEmail: String?
    @Published private(set) var activeCiphers: [CipherView] = []
    @Published var appTheme: AppTheme = .default
    @Published var bannerMessage: String?
    @Published var isBannerError = false
    @Published private(set) var busyLabel: String?
    @Published private(set) var fillErrorMessage: String?
    @Published private(set) var filledFieldCount = 0
    @Published private(set) var filledMediaType = ""
    @Published private(set) var filledOutputURL: URL?
    @Published private(set) var filledPreviewImage: UIImage?
    @Published private(set) var isBusy = false
    @Published var isOnDeviceOnly: Bool = NativeDecision.isOnDeviceOnlyEnabled {
        didSet {
            NativeDecision.isOnDeviceOnlyEnabled = isOnDeviceOnly
        }
    }
    @Published private(set) var isSignedIn = false
    @Published private(set) var languageTitle = ""
    @Published private(set) var originalFormPreviewImage: UIImage?
    @Published var searchQuery = ""
    @Published var selectedFilter: VowkeyItemKind = .all
    @Published var selectedProfileId = ""
    @Published private(set) var serverLabel = "vowkey.com"
    @Published var sortOrder: VowkeySortOrder = .kind
    @Published private(set) var trashedCiphers: [CipherView] = []

    let onCreateAccountRequested: () -> Void
    let onLockRequested: (String?) -> Void
    let onLogoutRequested: (String?) -> Void
    let onOpenAutofillSetup: () -> Void
    let onOpenLanguagePicker: () -> Void
    let onOpenSecuritySettings: () -> Void
    let onSignInRequested: () -> Void

    private var accountUserId: String?
    private var attachmentMemoryCache: [String: Data] = [:]
    private var autoSyncedUserIds: Set<String> = []
    private var originalsTask: Task<Void, Never>?
    private var retainedOriginalSignature: String?
    private let guest = NativeLocalVault.shared
    private var lastFormInput: (data: Data, fileName: String)?
    private var observationTasks: [Task<Void, Never>] = []
    private let services: WorkspaceServices
    private var thumbnailCache: [String: UIImage] = [:]

    var apiKeys: [CipherView] {
        activeCiphers.filter { $0.type == .apiKey }
    }

    var cards: [CipherView] {
        activeCiphers.filter { $0.type == .card || $0.type == .bankAccount }
    }

    var hasLoadedFormToRefill: Bool {
        lastFormInput != nil
    }

    var documents: [VowkeyDocumentEntry] {
        var entries: [VowkeyDocumentEntry] = []
        for cipher in profiles {
            guard let cipherId = cipher.id else { continue }
            let details = NativeProfile.details(cipher)
            for source in NativeProfile.sources(cipher) {
                let sourceId = (source["id"] as? String) ?? UUID().uuidString.lowercased()
                let attachmentId = NativeProfile.resolvedAttachmentKey(for: source, cipher: cipher)
                let fileName = (source["fileName"] as? String) ?? cipher.name
                let mediaType = (source["mediaType"] as? String) ?? "image/png"
                let documentKind = NativeProfile.humanDocumentTitle(for: source, fallbackName: fileName)
                let documentDate = (source["documentDate"] as? String)?.nilIfBlank
                let expiresOn = (source["expiresOn"] as? String)?.nilIfBlank
                let capturedAt = (source["capturedAt"] as? String)?.nilIfBlank
                let linkedCount = details.count(where: { NativeProfile.sourceId(for: $0) == sourceId })
                let isSampleDoc = attachmentId.hasPrefix(VowkeySampleWalkthrough.sampleAttachmentPrefix)
                    || cipher.name.localizedCaseInsensitiveContains("(Sample)")
                entries.append(
                    VowkeyDocumentEntry(
                        id: "\(cipherId):\(sourceId)",
                        cipherId: cipherId,
                        profileName: VowkeyMobileTheme.displayName(cipher.name),
                        sourceId: sourceId,
                        attachmentId: attachmentId,
                        fileName: fileName,
                        mediaType: mediaType,
                        documentKind: documentKind,
                        documentDate: documentDate,
                        expiresOn: expiresOn,
                        capturedAt: capturedAt,
                        isSample: isSampleDoc,
                        detailCount: max(linkedCount, details.count),
                    ),
                )
            }
        }
        return entries.sorted { lhs, rhs in
            if lhs.isExpiringSoon != rhs.isExpiringSoon {
                return lhs.isExpiringSoon && !rhs.isExpiringSoon
            }
            return lhs.displayTitle.localizedStandardCompare(rhs.displayTitle) == .orderedAscending
        }
    }

    var expiringCount: Int {
        documents.count(where: { $0.isExpired || $0.isExpiringSoon })
    }

    var filteredRows: [VowkeyVaultRowItem] {
        let trimmedQuery = searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        var rows: [VowkeyVaultRowItem] = []

        if selectedFilter == .document || selectedFilter == .expiring {
            let matchingDocs = documents.filter { doc in
                if selectedFilter == .expiring, !doc.isExpired, !doc.isExpiringSoon {
                    return false
                }
                guard !trimmedQuery.isEmpty else { return true }
                return doc.matches(query: trimmedQuery)
            }
            rows = matchingDocs.map { .document($0) }
        } else {
            let matchingCiphers = activeCiphers.filter { cipher in
                let kind = Self.itemKind(for: cipher)
                if selectedFilter != .all, kind != selectedFilter {
                    return false
                }
                guard !trimmedQuery.isEmpty else { return true }
                return Self.cipherMatches(cipher, query: trimmedQuery)
            }
            rows = matchingCiphers.map { .cipher($0) }
            if selectedFilter == .all, trimmedQuery.isEmpty {
                // Keep Vault clean: Profiles already link their source documents, while the Documents tab lists every source file.
            } else if selectedFilter == .all, !trimmedQuery.isEmpty {
                let extraDocs = documents.filter { $0.matches(query: trimmedQuery) }
                rows.append(contentsOf: extraDocs.map { .document($0) })
            }
        }

        return sortRows(rows)
    }

    var hasDocumentCamera: Bool {
        VNDocumentCameraViewController.isSupported
    }

    var hasSampleData: Bool {
        activeCiphers.contains(where: Self.isSampleCipher) || trashedCiphers.contains(where: Self.isSampleCipher)
    }

    var profiles: [CipherView] {
        activeCiphers.filter(NativeProfile.confirmed).sorted { lhs, rhs in
            if lhs.favorite != rhs.favorite {
                return lhs.favorite && !rhs.favorite
            }
            return lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
        }
    }

    var visibleFilterChips: [VowkeyItemKind] {
        var chips: [VowkeyItemKind] = [.all, .profile, .document, .login, .card, .key, .note]
        if activeCiphers.contains(where: { $0.type == .environment }) {
            chips.append(.environment)
        }
        if expiringCount > 0 {
            chips.insert(.expiring, at: 3)
        }
        return chips
    }

    // MARK: Initialization

    init(
        services: WorkspaceServices,
        onSignInRequested: @escaping () -> Void,
        onCreateAccountRequested: @escaping () -> Void,
        onOpenAutofillSetup: @escaping () -> Void,
        onOpenSecuritySettings: @escaping () -> Void,
        onOpenLanguagePicker: @escaping () -> Void,
        onLockRequested: @escaping (String?) -> Void,
        onLogoutRequested: @escaping (String?) -> Void,
    ) {
        self.services = services
        self.onSignInRequested = onSignInRequested
        self.onCreateAccountRequested = onCreateAccountRequested
        self.onOpenAutofillSetup = onOpenAutofillSetup
        self.onOpenSecuritySettings = onOpenSecuritySettings
        self.onOpenLanguagePicker = onOpenLanguagePicker
        self.onLockRequested = onLockRequested
        self.onLogoutRequested = onLogoutRequested
    }

    deinit {
        for task in observationTasks {
            task.cancel()
        }
    }

    // MARK: Static Helpers

    static func cipherMatches(_ cipher: CipherView, query: String) -> Bool {
        if cipher.name.localizedCaseInsensitiveContains(query) { return true }
        if let notes = cipher.notes, notes.localizedCaseInsensitiveContains(query) { return true }
        if let login = cipher.login {
            if login.username?.localizedCaseInsensitiveContains(query) == true { return true }
            if login.uris?.contains(where: { $0.uri?.localizedCaseInsensitiveContains(query) == true }) == true {
                return true
            }
        }
        if let card = cipher.card {
            if card.cardholderName?.localizedCaseInsensitiveContains(query) == true { return true }
            if card.brand?.localizedCaseInsensitiveContains(query) == true { return true }
            if card.number?.suffix(4).localizedCaseInsensitiveContains(query) == true { return true }
        }
        if let apiKey = cipher.apiKey {
            if apiKey.allowedHosts.contains(where: { $0.localizedCaseInsensitiveContains(query) }) { return true }
            if apiKey.headerName?.localizedCaseInsensitiveContains(query) == true { return true }
        }
        if NativeProfile.confirmed(cipher) {
            for detail in NativeProfile.details(cipher) {
                if (detail["label"] as? String)?.localizedCaseInsensitiveContains(query) == true { return true }
                if (detail["attribute"] as? String)?.localizedCaseInsensitiveContains(query) == true { return true }
                if NativeProfile.value(detail)?.localizedCaseInsensitiveContains(query) == true { return true }
                for variant in NativeProfile.variants(detail) {
                    if (variant["value"] as? String)?.localizedCaseInsensitiveContains(query) == true { return true }
                }
            }
        }
        return false
    }

    static func isSampleCipher(_ cipher: CipherView) -> Bool {
        if cipher.name.localizedCaseInsensitiveContains("(Sample)") {
            return true
        }
        return NativeProfile.sources(cipher).contains { source in
            ((source["attachmentId"] as? String) ?? "").hasPrefix(VowkeySampleWalkthrough.sampleAttachmentPrefix)
        }
    }

    nonisolated static func itemKind(for cipher: CipherView) -> VowkeyItemKind {
        switch cipher.type {
        case .apiKey:
            .key
        case .card, .bankAccount:
            .card
        case .environment:
            .environment
        case .identity, .driversLicense, .passport:
            .profile
        case .login:
            .login
        case .secureNote:
            .note
        case .sshKey:
            .key
        @unknown default:
            .note
        }
    }

    static func subtitle(for cipher: CipherView) -> String {
        switch cipher.type {
        case .apiKey:
            let style = cipher.apiKey?.sendStyle ?? "bearer"
            let host = cipher.apiKey?.allowedHosts.first
            return [style.capitalized, host].compactMap(\.self).joined(separator: " · ")
        case .card, .bankAccount:
            let brand = cipher.card?.brand?.nilIfBlank ?? VowkeyItemKind.card.singularTitle
            let tail = cipher.card?.number.map { String($0.suffix(4)) }?.nilIfBlank
            let base = tail.map { "\(brand) · •••• \($0)" } ?? brand
            return NativeCipher.agentRule(for: cipher) == "never" ? "\(base) · Don't fill" : base
        case .environment:
            let count = cipher.environment?.members.count ?? 0
            return count == 1 ? "1 binding" : "\(count) bindings"
        case .identity, .driversLicense, .passport:
            let detailCount = NativeProfile.details(cipher).count
            let docCount = NativeProfile.sources(cipher).count
            let detailPart = VowkeyMobileTheme.tr("VowkeyProfile", "Profile") + " · \(detailCount) details"
            return docCount > 0 ? "\(detailPart) · \(docCount) doc\(docCount == 1 ? "" : "s")" : detailPart
        case .login:
            if let username = cipher.login?.username?.nilIfBlank {
                return username
            }
            if let uri = cipher.login?.uris?.first?.uri?.nilIfBlank {
                return URL(string: uri)?.host ?? uri
            }
            return VowkeyItemKind.login.singularTitle
        case .secureNote:
            let firstLine = cipher.notes?
                .split(separator: "\n")
                .first
                .map { String($0).trimmingCharacters(in: .whitespacesAndNewlines) }
            return firstLine?.nilIfBlank ?? VowkeyItemKind.note.singularTitle
        case .sshKey:
            return VowkeyItemKind.key.singularTitle
        @unknown default:
            return VowkeyItemKind.note.singularTitle
        }
    }

    // MARK: Lifecycle & Observation

    func startObservingIfNeeded() {
        guard observationTasks.isEmpty else { return }
        let accountTask = Task { [weak self] in
            guard let self else { return }
            for await _ in await services.stateService.activeAccountIdPublisher().values {
                guard !Task.isCancelled else { return }
                await reload()
            }
        }
        let syncTask = Task { [weak self] in
            guard let self else { return }
            for await _ in services.syncService.syncCompletePublisher() {
                guard !Task.isCancelled else { return }
                await reload()
            }
        }
        observationTasks = [accountTask, syncTask]
    }

    func reload() async {
        appTheme = await services.stateService.getAppTheme()
        languageTitle = services.stateService.appLanguage.title
        serverLabel = services.environmentService.webVaultURL.host ?? "vowkey.com"

        do {
            if let activeAccount = try? await services.stateService.getActiveAccount(),
               try await services.stateService.isAuthenticated(userId: activeAccount.profile.userId) {
                let userId = activeAccount.profile.userId
                if accountUserId != userId {
                    attachmentMemoryCache.removeAll()
                    thumbnailCache.removeAll()
                }
                accountUserId = userId
                accountEmail = activeAccount.profile.email
                isSignedIn = true
                let keyBase64 = try await services.clientService.crypto().getUserEncryptionKey()
                guard let userKey = Data(base64Encoded: keyBase64) else {
                    throw NativeVaultError.locked
                }
                let vault = try await services.clientService.vault(for: userId)
                var encryptedAll = try await services.cipherService.fetchAllCiphers()
                if autoSyncedUserIds.insert(userId).inserted {
                    try? await services.syncService.fetchSync(forceSync: false)
                    encryptedAll = (try? await services.cipherService.fetchAllCiphers()) ?? encryptedAll
                }
                let decrypted = encryptedAll.compactMap { cipher in
                    try? vault.ciphers().decryptLegacyCipher(cipher: cipher, userKey: userKey)
                }
                applyLoadedCiphers(decrypted)
                let signature = Self.attachmentSignature(encryptedAll)
                if retainedOriginalSignature != signature {
                    originalsTask?.cancel()
                    originalsTask = Task { [weak self] in
                        guard let self else { return }
                        if await self.retainAccountOriginals(encryptedAll, userId: userId), !Task.isCancelled {
                            self.retainedOriginalSignature = signature
                        }
                    }
                }
            } else {
                if accountUserId != nil {
                    attachmentMemoryCache.removeAll()
                    thumbnailCache.removeAll()
                }
                accountUserId = nil
                accountEmail = nil
                isSignedIn = false
                try guest.unlock()
                let localAll = try guest.ciphers()
                applyLoadedCiphers(localAll)
            }
        } catch {
            showErrorBanner(error, fallback: "Couldn't load your vault right now.")
        }
    }

    func dismissBanner() {
        bannerMessage = nil
        isBannerError = false
    }

    func showStatusBanner(_ message: String) {
        isBannerError = false
        bannerMessage = message
    }

    func showErrorBanner(_ error: Error, fallback: String) {
        isBannerError = true
        bannerMessage = Self.humanErrorMessage(for: error, fallback: fallback)
    }

    static func humanErrorMessage(for error: Error, fallback: String) -> String {
        if let vaultError = error as? NativeVaultError, let desc = vaultError.errorDescription {
            return desc
        }
        let nsError = error as NSError
        if error is URLError || nsError.domain == NSURLErrorDomain {
            return "Couldn't reach Vowkey. Check your connection and try again."
        }
        if let localized = (error as? LocalizedError)?.errorDescription?.trimmingCharacters(in: .whitespacesAndNewlines),
           !localized.isEmpty,
           !localized.contains("NSURLError"),
           !localized.contains("The operation couldn") {
            return localized
        }
        return fallback
    }

    static func mediaType(for url: URL) -> String {
        switch url.pathExtension.lowercased() {
        case "pdf":
            "application/pdf"
        case "png":
            "image/png"
        case "heic", "heif":
            "image/heic"
        case "docx":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "xlsx":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        case "hwpx":
            "application/hwp+zip"
        default:
            "image/jpeg"
        }
    }

    private func applyLoadedCiphers(_ all: [CipherView]) {
        activeCiphers = all.filter { $0.deletedDate == nil }
        trashedCiphers = all
            .filter { $0.deletedDate != nil }
            .sorted { ($0.deletedDate ?? .distantPast) > ($1.deletedDate ?? .distantPast) }
        if selectedProfileId.isEmpty || !profiles.contains(where: { $0.id == selectedProfileId }) {
            selectedProfileId = profiles.first?.id ?? ""
        }
    }

    private func sortRows(_ rows: [VowkeyVaultRowItem]) -> [VowkeyVaultRowItem] {
        rows.sorted { lhs, rhs in
            if lhs.isPinned != rhs.isPinned {
                return lhs.isPinned && !rhs.isPinned
            }
            switch sortOrder {
            case .kind:
                if lhs.kindSortRank != rhs.kindSortRank {
                    return lhs.kindSortRank < rhs.kindSortRank
                }
                return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
            case .name:
                return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
            case .recent:
                if lhs.revisionDate != rhs.revisionDate {
                    return lhs.revisionDate > rhs.revisionDate
                }
                return lhs.title.localizedStandardCompare(rhs.title) == .orderedAscending
            }
        }
    }
}

// MARK: - VowkeyWorkspaceModel + Sample Walkthrough & Capture

extension VowkeyWorkspaceModel {
    func loadSampleScenario(_ scenario: VowkeySampleScenario) async {
        do {
            let cipher = try VowkeySampleWalkthrough.buildCipher(for: scenario)
            try await persistNewOrUpdatedCipher(cipher)
            await reload()
            if let saved = profiles.first(where: { $0.name == scenario.profileName }) {
                selectedProfileId = saved.id ?? selectedProfileId
            }
            showStatusBanner("Added sample profile: \(scenario.pickerLabel)")
        } catch {
            showErrorBanner(error, fallback: "Couldn't load sample profile.")
        }
    }

    func loadAllSamples() async {
        do {
            for scenario in VowkeySampleWalkthrough.scenarios {
                if activeCiphers.contains(where: { $0.name == scenario.profileName }) { continue }
                let cipher = try VowkeySampleWalkthrough.buildCipher(for: scenario)
                try await persistNewOrUpdatedCipher(cipher)
            }
            await reload()
            showStatusBanner("Sample documents ready")
        } catch {
            showErrorBanner(error, fallback: "Couldn't load sample documents.")
        }
    }

    func clearSampleData() async {
        let samples = (activeCiphers + trashedCiphers).filter(Self.isSampleCipher)
        for sample in samples {
            await deletePermanently(sample, reloadAfter: false)
        }
        await reload()
        showStatusBanner("Removed sample data")
    }

    func requestCameraAccess() async -> Bool {
        await services.cameraService.checkStatusOrRequestCameraAuthorization() == .authorized
    }

    func captureDocumentFile(
        data: Data,
        fileName: String,
        mediaType: String,
        intoProfileId: String? = nil,
    ) async -> CipherView? {
        dismissBanner()
        isBusy = true
        busyLabel = "Reading \(fileName)…"
        defer {
            isBusy = false
            busyLabel = nil
        }
        do {
            let accountTuple = currentDecisionAccount()
            let captured = try await NativeDecision.readFile(
                data: data,
                fileName: fileName,
                mediaType: mediaType,
                account: accountTuple,
                userId: accountUserId,
                installationId: guest.installationId,
            )
            let saved = try await persistCapturedDocument(
                captured,
                fileName: fileName,
                mediaType: mediaType,
                rawData: data,
                intoProfileId: intoProfileId,
            )
            await reload()
            let count = (captured["details"] as? [String: Any])?.count ?? 0
            showStatusBanner(count > 0 ? Localizations.vowkeyXDetails(count) : "Saved \(fileName)")
            return cipher(withId: saved.id) ?? saved
        } catch {
            showErrorBanner(error, fallback: "Couldn't read that document. Try a clearer photo or another file.")
            return nil
        }
    }

    private func currentDecisionAccount() -> NativeDecision.Account? {
        guard isSignedIn, accountUserId != nil else { return nil }
        return (services.cipherService, services.clientService, services.stateService, services.apiService)
    }

    private func persistCapturedDocument(
        _ read: [String: Any],
        fileName: String,
        mediaType: String,
        rawData: Data,
        intoProfileId: String?,
    ) async throws -> CipherView {
        let localAttachmentId = UUID().uuidString.lowercased()
        let targetProfile: CipherView? = if let intoProfileId, !intoProfileId.isEmpty {
            profiles.first { $0.id == intoProfileId }
        } else {
            nil
        }

        if isSignedIn, let userId = accountUserId {
            let vault = try await services.clientService.vault(for: userId)
            let keyBase64 = try await services.clientService.crypto().getUserEncryptionKey()
            let userKey = Data(base64Encoded: keyBase64) ?? Data()

            let baseCipher: Cipher
            if let existing = targetProfile, let existingId = existing.id {
                if let fetched = try await services.cipherService.fetchCipher(withId: existingId) {
                    baseCipher = fetched
                } else {
                    let ctx = try await vault.ciphers().encrypt(cipherView: existing)
                    try await services.cipherService.updateCipherWithServer(
                        ctx.cipher,
                        encryptedByKeyId: ctx.encryptedByKeyId,
                        encryptedFor: userId,
                    )
                    baseCipher = ctx.cipher
                }
            } else {
                let initialDraft = try NativeProfile.captured(
                    read,
                    fileName: fileName,
                    mediaType: mediaType,
                    attachmentId: localAttachmentId,
                    into: nil,
                )
                let ctx = try await vault.ciphers().encrypt(cipherView: initialDraft)
                baseCipher = try await services.cipherService.addCipherWithServer(
                    ctx.cipher,
                    encryptedByKeyId: ctx.encryptedByKeyId,
                    encryptedFor: userId,
                )
            }

            let existingAttachmentIds = Set((baseCipher.attachments ?? []).compactMap(\.id))
            let encryptedAttachment = try await vault.ciphers().encryptLegacyAttachment(
                cipher: baseCipher,
                attachment: AttachmentView(
                    id: localAttachmentId,
                    url: nil,
                    size: String(rawData.count),
                    sizeName: nil,
                    fileName: fileName,
                    key: nil,
                ),
                contents: rawData,
                userKey: userKey,
            )
            let cipherWithAttachment = try await services.cipherService.saveAttachmentWithServer(
                cipher: baseCipher,
                attachment: encryptedAttachment,
            )
            let serverAttachmentId = cipherWithAttachment.attachments?
                .first(where: { att in
                    guard let id = att.id else { return false }
                    return !existingAttachmentIds.contains(id)
                })?.id
                ?? cipherWithAttachment.attachments?.last?.id
                ?? localAttachmentId
            attachmentMemoryCache[serverAttachmentId] = rawData

            let decryptedShell = try await vault.ciphers().decryptLegacyCipher(
                cipher: cipherWithAttachment,
                userKey: userKey,
            )
            let targetWithServerId: CipherView? = if let targetProfile {
                NativeCipher.replacing(
                    targetProfile,
                    id: decryptedShell.id,
                    attachments: decryptedShell.attachments,
                )
            } else {
                nil
            }
            var finalProfile = try NativeProfile.captured(
                read,
                fileName: fileName,
                mediaType: mediaType,
                attachmentId: serverAttachmentId,
                into: targetWithServerId,
            )
            finalProfile = NativeCipher.replacing(
                finalProfile,
                id: decryptedShell.id,
                attachments: decryptedShell.attachments,
            )
            let finalCtx = try await vault.ciphers().encrypt(cipherView: finalProfile)
            try await services.cipherService.updateCipherWithServer(
                finalCtx.cipher,
                encryptedByKeyId: finalCtx.encryptedByKeyId,
                encryptedFor: userId,
            )
            return finalProfile
        } else {
            attachmentMemoryCache[localAttachmentId] = rawData
            let builtProfile = try NativeProfile.captured(
                read,
                fileName: fileName,
                mediaType: mediaType,
                attachmentId: localAttachmentId,
                into: targetProfile,
            )
            try guest.unlock()
            return try guest.save(
                builtProfile,
                attachment: (localAttachmentId, fileName, rawData),
            )
        }
    }
}

// MARK: - VowkeyWorkspaceModel + Form Filling & Source Rendering

extension VowkeyWorkspaceModel {
    func clearFilledFormResult() {
        filledOutputURL = nil
        filledPreviewImage = nil
        originalFormPreviewImage = nil
        filledMediaType = ""
        filledFieldCount = 0
        fillErrorMessage = nil
        lastFormInput = nil
    }

    func refillLastForm(profileId: String) async {
        guard let last = lastFormInput else { return }
        await fillFormFile(data: last.data, fileName: last.fileName, profileId: profileId)
    }

    func fillFormFile(data: Data, fileName: String, profileId: String? = nil) async {
        guard !isBusy else { return }
        guard !profiles.isEmpty else {
            isBannerError = true
            bannerMessage = Localizations.vowkeySaveProfileBeforeFilling
            return
        }
        clearFilledFormResult()
        dismissBanner()
        let chosenId = (profileId?.nilIfBlank) ?? selectedProfileId
        selectedProfileId = chosenId
        lastFormInput = (data: data, fileName: fileName)
        isBusy = true
        busyLabel = "Filling \(fileName)…"
        defer {
            isBusy = false
            busyLabel = nil
        }
        do {
            if let pdfDoc = PDFDocument(data: data), pdfDoc.pageCount > 0 {
                originalFormPreviewImage = pdfDoc.page(at: 0)?.thumbnail(of: CGSize(width: 1400, height: 1960), for: .mediaBox)
            } else if let rawImg = UIImage(data: data) {
                originalFormPreviewImage = Self.normalizeImageOrientation(rawImg, maxDimension: 1800)
            } else {
                originalFormPreviewImage = nil
            }
            let result = try await NativeDecision.fillFormFile(
                data: data,
                fileName: fileName,
                profiles: profiles,
                cards: cards,
                selectedProfileId: chosenId,
                account: currentDecisionAccount(),
                userId: accountUserId,
                installationId: guest.installationId,
            )
            guard result.filledCount > 0 else {
                fillErrorMessage = "No matching fields were found on this form for the selected profile."
                return
            }
            let outURL = FileManager.default.temporaryDirectory.appendingPathComponent(result.fileName)
            try result.data.write(to: outURL, options: .atomic)
            filledOutputURL = outURL
            filledMediaType = result.mediaType
            filledFieldCount = result.filledCount
            if result.mediaType == "application/pdf" {
                filledPreviewImage = PDFDocument(data: result.data)?
                    .page(at: 0)?
                    .thumbnail(of: CGSize(width: 1400, height: 1960), for: .mediaBox)
            } else if result.mediaType.hasPrefix("image/") {
                filledPreviewImage = UIImage(data: result.data)
            } else {
                filledPreviewImage = nil
            }
        } catch {
            fillErrorMessage = Self.humanErrorMessage(
                for: error,
                fallback: "Couldn't fill that form right now. Try again.",
            )
        }
    }

    func loadSourcePageImage(
        cipherId: String,
        attachmentId: String,
        pageIndex: Int = 0,
        maxDimension: CGFloat = 1400,
    ) async -> UIImage? {
        let cacheKey = "\(cipherId)|\(attachmentId)|\(pageIndex)|\(Int(maxDimension))"
        if let cached = thumbnailCache[cacheKey] {
            return cached
        }
        if attachmentId.hasPrefix(VowkeySampleWalkthrough.sampleAttachmentPrefix) {
            let scenarioId = String(attachmentId.dropFirst(VowkeySampleWalkthrough.sampleAttachmentPrefix.count))
            if let scenario = VowkeySampleWalkthrough.scenario(forId: scenarioId) {
                let image = VowkeySampleWalkthrough.renderSampleImage(for: scenario)
                thumbnailCache[cacheKey] = image
                return image
            }
        }
        guard let rawBytes = await rawAttachmentBytes(cipherId: cipherId, attachmentId: attachmentId) else {
            return nil
        }
        let rendered = Self.renderDocumentPage(data: rawBytes, pageIndex: pageIndex, maxDimension: maxDimension)
        if let rendered {
            thumbnailCache[cacheKey] = rendered
        }
        return rendered
    }

    func rawAttachmentBytes(cipherId: String, attachmentId: String) async -> Data? {
        guard !attachmentId.isEmpty else { return nil }
        if attachmentId.hasPrefix(VowkeySampleWalkthrough.sampleAttachmentPrefix) {
            let scenarioId = String(attachmentId.dropFirst(VowkeySampleWalkthrough.sampleAttachmentPrefix.count))
            if let scenario = VowkeySampleWalkthrough.scenario(forId: scenarioId) {
                return VowkeySampleWalkthrough.renderSampleImage(for: scenario).pngData()
            }
        }
        let cacheKey = "\(cipherId):\(attachmentId)"
        if let cached = attachmentMemoryCache[cacheKey] {
            return cached
        }
        if isSignedIn, let userId = accountUserId, let ownerCipher = cipher(withId: cipherId),
           let target = Self.matchingAttachment(ownerCipher, attachmentId: attachmentId) {
            let resolvedId = target.id ?? attachmentId
            if guest.hasAccountOriginal(userId: userId, cipherId: cipherId, attachmentId: resolvedId),
               let local = guest.accountOriginal(userId: userId, cipherId: cipherId, attachmentId: resolvedId),
               let encryptedCipher = try? await services.cipherService.fetchCipher(withId: cipherId),
               let encryptedAttachment = encryptedCipher.attachments?.first(where: { $0.id == resolvedId }),
               let keyBase64 = try? await services.clientService.crypto().getUserEncryptionKey(),
               let userKey = Data(base64Encoded: keyBase64),
               let bytes = try? await services.clientService.vault(for: userId).ciphers().decryptLegacyAttachment(
                   cipher: encryptedCipher, attachment: encryptedAttachment, contents: local, userKey: userKey),
               !bytes.isEmpty {
                attachmentMemoryCache[cacheKey] = bytes
                return bytes
            }
            if let decryptedURL = try? await services.vaultRepository.downloadAttachment(target, cipher: ownerCipher) {
                try? FileManager.default.removeItem(at: decryptedURL)
                if guest.hasAccountOriginal(userId: userId, cipherId: cipherId, attachmentId: resolvedId),
                   let retained = guest.accountOriginal(userId: userId, cipherId: cipherId, attachmentId: resolvedId),
                   let encryptedCipher = try? await services.cipherService.fetchCipher(withId: cipherId),
                   let encryptedAttachment = encryptedCipher.attachments?.first(where: { $0.id == resolvedId }),
                   let keyBase64 = try? await services.clientService.crypto().getUserEncryptionKey(),
                   let userKey = Data(base64Encoded: keyBase64),
                   let localBytes = try? await services.clientService.vault(for: userId).ciphers().decryptLegacyAttachment(
                       cipher: encryptedCipher, attachment: encryptedAttachment, contents: retained, userKey: userKey),
                   !localBytes.isEmpty {
                    attachmentMemoryCache[cacheKey] = localBytes
                    return localBytes
                }
            }
        }
        try? guest.unlock()
        if let bytes = try? guest.attachmentBytes(cipherId: cipherId, attachmentId: attachmentId) {
            attachmentMemoryCache[cacheKey] = bytes
            return bytes
        }
        return nil
    }

    private func retainAccountOriginals(_ ciphers: [Cipher], userId: String) async -> Bool {
        var complete = true
        for cipher in ciphers {
            if Task.isCancelled { return false }
            guard let cipherId = cipher.id else { continue }
            let live = Set((cipher.attachments ?? []).compactMap(\.id))
            for stored in guest.storedAccountOriginalIds(userId: userId, cipherId: cipherId).subtracting(live) {
                guest.deleteAccountOriginal(userId: userId, cipherId: cipherId, attachmentId: stored)
            }
            for attachment in cipher.attachments ?? [] {
                if Task.isCancelled { return false }
                guard let attachmentId = attachment.id else { continue }
                if guest.hasAccountOriginal(userId: userId, cipherId: cipherId, attachmentId: attachmentId) { continue }
                guard let downloaded = try? await services.cipherService.downloadAttachment(withId: attachmentId, cipherId: cipherId),
                      let encrypted = try? Data(contentsOf: downloaded), !encrypted.isEmpty else {
                    complete = false
                    continue
                }
                do {
                    try guest.retainAccountOriginal(userId: userId, cipherId: cipherId, attachmentId: attachmentId, bytes: encrypted)
                } catch {
                    complete = false
                }
                try? FileManager.default.removeItem(at: downloaded)
            }
        }
        return complete
    }

    private static func attachmentSignature(_ ciphers: [Cipher]) -> String {
        ciphers.flatMap { cipher in
            (cipher.attachments ?? []).compactMap { attachment in
                cipher.id.flatMap { id in attachment.id.map { "\(id):\($0)" } }
            }
        }.sorted().joined(separator: "|")
    }

    private static func matchingAttachment(_ cipher: CipherView, attachmentId: String) -> AttachmentView? {
        let attachments = cipher.attachments ?? []
        let sources = NativeProfile.sources(cipher)
        let matchedSource = sources.first {
            ($0["attachmentId"] as? String) == attachmentId || ($0["id"] as? String) == attachmentId
        }
        let sourceFileName = (matchedSource?["fileName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        return attachments.first(where: { $0.id == attachmentId })
            ?? sourceFileName.flatMap { name in
                attachments.first { $0.fileName == name || $0.fileName?.caseInsensitiveCompare(name) == .orderedSame }
            }
            ?? (sources.count <= 1 && attachments.count == 1 ? attachments.first : nil)
    }

    static func renderDocumentPage(data: Data, pageIndex: Int, maxDimension: CGFloat) -> UIImage? {
        if let pdf = PDFDocument(data: data), pdf.pageCount > 0 {
            let clampedIndex = min(max(0, pageIndex), pdf.pageCount - 1)
            guard let page = pdf.page(at: clampedIndex) else { return nil }
            let bounds = page.bounds(for: .mediaBox)
            let aspect = bounds.height > 0 ? (bounds.width / bounds.height) : 0.707
            let size = aspect >= 1
                ? CGSize(width: maxDimension, height: max(1, maxDimension / aspect))
                : CGSize(width: max(1, maxDimension * aspect), height: maxDimension)
            return page.thumbnail(of: size, for: .mediaBox)
        }
        guard let image = UIImage(data: data) else { return nil }
        return normalizeImageOrientation(image, maxDimension: maxDimension)
    }

    private static func normalizeImageOrientation(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let pixelSize = image.size
        guard pixelSize.width > 0, pixelSize.height > 0 else { return image }
        let scaleFactor = min(1.0, maxDimension / max(pixelSize.width, pixelSize.height))
        let targetSize = CGSize(
            width: round(pixelSize.width * scaleFactor),
            height: round(pixelSize.height * scaleFactor),
        )
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}

// MARK: - VowkeyWorkspaceModel + Item & Profile CRUD

extension VowkeyWorkspaceModel {
    func cipher(withId id: String?) -> CipherView? {
        guard let id else { return nil }
        return activeCiphers.first { $0.id == id } ?? trashedCiphers.first { $0.id == id }
    }

    func saveCipher(_ view: CipherView) async -> CipherView? {
        do {
            let saved = try await persistNewOrUpdatedCipher(view)
            await reload()
            return cipher(withId: saved.id) ?? saved
        } catch {
            showErrorBanner(error, fallback: "Couldn't save changes right now.")
            return nil
        }
    }

    func addProfile(name: String, initialDetails: [(String, String)]) async -> CipherView? {
        do {
            let profile = try NativeProfile.typed(name: name, rows: initialDetails)
            return await saveCipher(profile)
        } catch {
            showErrorBanner(error, fallback: "Please enter a name and at least one detail.")
            return nil
        }
    }

    func renameProfile(_ cipher: CipherView, newName: String) async {
        guard let updated = try? NativeProfile.renamed(cipher, name: newName) else { return }
        _ = await saveCipher(updated)
    }

    func upsertProfileDetail(
        cipher: CipherView,
        detailId: String?,
        label: String,
        value: String,
        attribute: String?,
        agentRule: String,
    ) async {
        do {
            let updated: CipherView = if let detailId {
                try NativeProfile.updatingDetail(
                    cipher,
                    detailId: detailId,
                    value: value,
                    label: label,
                    agentRule: agentRule,
                )
            } else {
                try NativeProfile.addingDetail(
                    cipher,
                    label: label,
                    value: value,
                    attribute: attribute,
                    agentRule: agentRule,
                )
            }
            _ = await saveCipher(updated)
        } catch {
            showErrorBanner(error, fallback: "Couldn't complete that action right now.")
        }
    }

    func deleteProfileDetail(cipher: CipherView, detailId: String) async {
        do {
            let updated = try NativeProfile.removingDetail(cipher, detailId: detailId)
            _ = await saveCipher(updated)
        } catch {
            showErrorBanner(error, fallback: "Couldn't complete that action right now.")
        }
    }

    func selectDetailVariant(cipher: CipherView, detailId: String, value: String) async {
        do {
            let updated = try NativeProfile.choosingVariant(cipher, detailId: detailId, chosenValue: value)
            _ = await saveCipher(updated)
        } catch {
            showErrorBanner(error, fallback: "Couldn't complete that action right now.")
        }
    }

    func togglePin(_ cipher: CipherView) async {
        let updated = NativeCipher.replacing(cipher, favorite: !cipher.favorite)
        _ = await saveCipher(updated)
    }

    func setItemAgentRule(_ cipher: CipherView, rule: String) async {
        let updated = NativeCipher.settingAgentRule(rule, on: cipher)
        _ = await saveCipher(updated)
    }

    func setProfileDetailAgentRule(cipher: CipherView, detailId: String, rule: String) async {
        guard let detail = NativeProfile.details(cipher).first(where: { ($0["id"] as? String) == detailId }),
              let currentValue = NativeProfile.value(detail) else { return }
        do {
            let updated = try NativeProfile.corrected(cipher, detailId: detailId, value: currentValue, rule: rule)
            _ = await saveCipher(updated)
        } catch {
            showErrorBanner(error, fallback: "Couldn't complete that action right now.")
        }
    }

    func softDelete(_ cipher: CipherView) async {
        guard let cipherId = cipher.id else { return }
        do {
            if isSignedIn, let encrypted = try await services.cipherService.fetchCipher(withId: cipherId) {
                try await services.cipherService.softDeleteCipherWithServer(id: cipherId, encrypted)
            } else {
                try guest.unlock()
                let trashed = NativeCipher.withDeletedDate(cipher, deletedDate: Date())
                _ = try guest.save(trashed)
            }
            await reload()
            showStatusBanner("Moved to recently deleted")
        } catch {
            showErrorBanner(error, fallback: "Couldn't move this item right now.")
        }
    }

    func restore(_ cipher: CipherView) async {
        guard let cipherId = cipher.id else { return }
        do {
            if isSignedIn, let encrypted = try await services.cipherService.fetchCipher(withId: cipherId) {
                try await services.cipherService.restoreCipherWithServer(id: cipherId, encrypted)
            } else {
                try guest.unlock()
                let restored = NativeCipher.withDeletedDate(cipher, deletedDate: nil)
                _ = try guest.save(restored)
            }
            await reload()
            showStatusBanner("Restored to vault")
        } catch {
            showErrorBanner(error, fallback: "Couldn't restore this item right now.")
        }
    }

    func deletePermanently(_ cipher: CipherView, reloadAfter: Bool = true) async {
        guard let cipherId = cipher.id else { return }
        do {
            if isSignedIn {
                try await services.cipherService.deleteCipherWithServer(id: cipherId)
            } else {
                try guest.unlock()
                try guest.delete(cipher)
            }
            if reloadAfter {
                await reload()
            }
        } catch {
            showErrorBanner(error, fallback: "Couldn't delete this item right now.")
        }
    }

    func emptyRecentlyDeleted() async {
        for item in trashedCiphers {
            await deletePermanently(item, reloadAfter: false)
        }
        await reload()
        showStatusBanner("Emptied recently deleted")
    }

    private func persistNewOrUpdatedCipher(_ view: CipherView) async throws -> CipherView {
        let existingId = view.id.flatMap { candidateId in
            (activeCiphers.contains { $0.id == candidateId } || trashedCiphers.contains { $0.id == candidateId })
                ? candidateId
                : nil
        }
        if isSignedIn, let userId = accountUserId {
            let vault = try await services.clientService.vault(for: userId)
            let context = try await vault.ciphers().encrypt(cipherView: view)
            let savedCipher: Cipher
            if existingId != nil {
                try await services.cipherService.updateCipherWithServer(
                    context.cipher,
                    encryptedByKeyId: context.encryptedByKeyId,
                    encryptedFor: userId,
                )
                savedCipher = context.cipher
            } else {
                savedCipher = try await services.cipherService.addCipherWithServer(
                    context.cipher,
                    encryptedByKeyId: context.encryptedByKeyId,
                    encryptedFor: userId,
                )
            }
            let keyBase64 = try await services.clientService.crypto().getUserEncryptionKey()
            let userKey = Data(base64Encoded: keyBase64) ?? Data()
            return try await vault.ciphers().decryptLegacyCipher(cipher: savedCipher, userKey: userKey)
        } else {
            try guest.unlock()
            return try guest.save(view)
        }
    }
}

// MARK: - VowkeyWorkspaceModel + Settings, Sync, Export & Simulator Hooks

extension VowkeyWorkspaceModel {
    func syncNow() async {
        guard isSignedIn else {
            await reload()
            return
        }
        isBusy = true
        busyLabel = "Syncing…"
        defer {
            isBusy = false
            busyLabel = nil
        }
        do {
            try await services.syncService.fetchSync(forceSync: true)
            await reload()
            showStatusBanner("Synced")
        } catch {
            showErrorBanner(error, fallback: "Couldn't sync right now. Check your connection.")
        }
    }

    func updateTheme(_ theme: AppTheme) async {
        appTheme = theme
        await services.stateService.setAppTheme(theme)
    }

    func lockCurrentSession() {
        if isSignedIn {
            onLockRequested(accountUserId)
        } else {
            guest.lock()
            showStatusBanner("Locked local session")
            Task { await reload() }
        }
    }

    func logoutCurrentAccount() {
        guard isSignedIn else { return }
        onLogoutRequested(accountUserId)
    }

    #if DEBUG
    func runSimulatorAutoFlowIfRequested() async {
        let env = ProcessInfo.processInfo.environment
        if env["VOWKEY_SIM_ON_DEVICE_ONLY"] == "1" {
            isOnDeviceOnly = true
        } else if env["VOWKEY_SIM_ON_DEVICE_ONLY"] == "0" {
            isOnDeviceOnly = false
        }
        if env["VOWKEY_SIM_AUTO_SAMPLE"] == "1", !hasSampleData {
            await loadAllSamples()
        }
        if let seedPath = env["VOWKEY_SIM_SEED_JSON_PATH"], !seedPath.isEmpty,
           let seedData = try? Data(contentsOf: URL(fileURLWithPath: seedPath)),
           let seedItems = (try? JSONSerialization.jsonObject(with: seedData)) as? [[String: Any]] {
            try? guest.unlock()
            for entry in seedItems {
                guard let name = entry["name"] as? String,
                      var meta = entry["meta"] as? [String: Any] else { continue }
                let id = (entry["id"] as? String) ?? UUID().uuidString.lowercased()
                if activeCiphers.contains(where: { $0.id == id || $0.name == name }) { continue }
                let attachmentPaths = (entry["attachmentPaths"] as? [String: String]) ?? [:]
                let base = NativeCipher.make(type: .identity, name: name, id: id)
                if let built = try? NativeProfile.applying(meta, to: base) {
                    _ = try? guest.save(built)
                    if let sources = meta["sources"] as? [[String: Any]] {
                        for src in sources {
                            if let attId = src["attachmentId"] as? String,
                               let diskPath = attachmentPaths[attId],
                               let fileBytes = try? Data(contentsOf: URL(fileURLWithPath: diskPath)) {
                                let fname = (src["fileName"] as? String) ?? "doc.jpg"
                                _ = try? guest.save(built, attachment: (attId, fname, fileBytes))
                                attachmentMemoryCache[attId] = fileBytes
                            }
                        }
                    }
                }
            }
            await reload()
        }
        if let selectName = env["VOWKEY_SIM_SELECT_PROFILE"], !selectName.isEmpty,
           let matched = profiles.first(where: { $0.name.localizedCaseInsensitiveContains(selectName) }) {
            selectedProfileId = matched.id ?? selectedProfileId
        }
        if let neverAttr = env["VOWKEY_SIM_SET_NEVER_ATTR"], !neverAttr.isEmpty {
            for profile in profiles {
                for detail in NativeProfile.details(profile) where (detail["attribute"] as? String) == neverAttr {
                    if let did = detail["id"] as? String {
                        await setProfileDetailAgentRule(cipher: profile, detailId: did, rule: "never")
                    }
                }
            }
        }
        if let readPaths = env["VOWKEY_SIM_AUTO_READ_PATHS"], !readPaths.isEmpty {
            for rawPath in readPaths.split(separator: ";").map(String.init) where !rawPath.isEmpty {
                let url = URL(fileURLWithPath: rawPath)
                guard let data = try? Data(contentsOf: url) else { continue }
                let ext = url.pathExtension.lowercased()
                let mime = ext == "pdf" ? "application/pdf" : (ext == "png" ? "image/png" : "image/jpeg")
                _ = await captureDocumentFile(data: data, fileName: url.lastPathComponent, mediaType: mime)
            }
        }
        if let fillPath = env["VOWKEY_SIM_AUTO_FILL_PATH"], !fillPath.isEmpty {
            let url = URL(fileURLWithPath: fillPath)
            if let data = try? Data(contentsOf: url) {
                await fillFormFile(data: data, fileName: url.lastPathComponent, profileId: selectedProfileId)
                if let outCopyPath = env["VOWKEY_SIM_FILL_OUT_PATH"], !outCopyPath.isEmpty,
                   let filledURL = filledOutputURL,
                   let filledBytes = try? Data(contentsOf: filledURL) {
                    try? filledBytes.write(to: URL(fileURLWithPath: outCopyPath), options: .atomic)
                }
            }
        }
    }
    #endif
}

// MARK: - VowkeySortOrder

enum VowkeySortOrder: String, CaseIterable, Identifiable {
    case kind
    case name
    case recent

    var id: String { rawValue }

    var title: String {
        switch self {
        case .kind:
            VowkeyMobileTheme.tr("VowkeySortKind", "Kind")
        case .name:
            VowkeyMobileTheme.tr("Name", "Name")
        case .recent:
            VowkeyMobileTheme.tr("VowkeySortRecent", "Recently changed")
        }
    }
}

// MARK: - VowkeyDocumentEntry

struct VowkeyDocumentEntry: Identifiable, Hashable {
    let id: String
    let cipherId: String
    let profileName: String
    let sourceId: String
    let attachmentId: String
    let fileName: String
    let mediaType: String
    let documentKind: String
    let documentDate: String?
    let expiresOn: String?
    let capturedAt: String?
    let isSample: Bool
    let detailCount: Int

    var displayTitle: String {
        if documentKind.lowercased() != "document", !documentKind.isEmpty {
            return documentKind
        }
        return fileName
    }

    var daysUntilExpiry: Int? {
        guard let expiresOn, let expiryDate = Self.parseISODate(expiresOn) else { return nil }
        let start = Calendar.current.startOfDay(for: Date())
        let end = Calendar.current.startOfDay(for: expiryDate)
        return Calendar.current.dateComponents([.day], from: start, to: end).day
    }

    var isExpired: Bool {
        guard let days = daysUntilExpiry else { return false }
        return days < 0
    }

    var isExpiringSoon: Bool {
        guard let days = daysUntilExpiry else { return false }
        return days >= 0 && days <= 180
    }

    var expiryBadgeText: String? {
        guard let expiresOn else { return nil }
        if let days = daysUntilExpiry {
            if days < 0 {
                return "Expired \(expiresOn)"
            }
            if days <= 180 {
                return "Expires in \(days)d"
            }
        }
        return "Valid until \(expiresOn)"
    }

    func matches(query: String) -> Bool {
        displayTitle.localizedCaseInsensitiveContains(query)
            || fileName.localizedCaseInsensitiveContains(query)
            || profileName.localizedCaseInsensitiveContains(query)
            || (expiresOn?.localizedCaseInsensitiveContains(query) == true)
    }

    private static func parseISODate(_ raw: String) -> Date? {
        let prefix = String(raw.prefix(10))
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: prefix)
    }
}

// MARK: - VowkeyVaultRowItem

enum VowkeyVaultRowItem: Identifiable {
    case cipher(CipherView)
    case document(VowkeyDocumentEntry)

    var id: String {
        switch self {
        case let .cipher(cipher):
            "cipher:\(cipher.id ?? cipher.name)"
        case let .document(doc):
            "doc:\(doc.id)"
        }
    }

    var isPinned: Bool {
        switch self {
        case let .cipher(cipher):
            cipher.favorite
        case .document:
            false
        }
    }

    var kindSortRank: Int {
        switch self {
        case let .cipher(cipher):
            switch VowkeyWorkspaceModel.itemKind(for: cipher) {
            case .profile: 0
            case .document: 1
            case .login: 2
            case .card: 3
            case .key: 4
            case .environment: 5
            case .note: 6
            default: 7
            }
        case .document:
            1
        }
    }

    var revisionDate: Date {
        switch self {
        case let .cipher(cipher):
            cipher.revisionDate
        case .document:
            .distantPast
        }
    }

    var title: String {
        switch self {
        case let .cipher(cipher):
            cipher.name
        case let .document(doc):
            doc.displayTitle
        }
    }
}

// MARK: - VowkeySecretGenerator

enum VowkeyGeneratorMode: String, CaseIterable, Identifiable {
    case passphrase
    case password
    case pin

    var id: String { rawValue }

    var title: String {
        switch self {
        case .passphrase:
            "Passphrase"
        case .password:
            "Password"
        case .pin:
            "PIN"
        }
    }
}

enum VowkeySecretGenerator {
    private static let words = [
        "amber", "anchor", "apricot", "atlas", "autumn", "bamboo", "beacon", "birch",
        "breeze", "bridge", "canyon", "cedar", "cobalt", "comet", "coral", "cosmos",
        "crystal", "cypress", "dawn", "delta", "dune", "echo", "ember", "falcon",
        "fern", "fjord", "flint", "forest", "frost", "glacier", "granite", "harbor",
        "hazel", "horizon", "indigo", "island", "ivory", "jasper", "juniper", "lantern",
        "laurel", "linen", "lotus", "maple", "meadow", "mercury", "mineral", "mist",
        "monolith", "nebula", "oak", "obsidian", "olive", "onyx", "opal", "orbit",
        "orchid", "osprey", "pebble", "pine", "plume", "prairie", "prism", "quartz",
        "raven", "reef", "ridge", "river", "saffron", "sage", "sequoia", "shadow",
        "sierra", "silver", "solstice", "sparrow", "spruce", "summit", "SUNSET".lowercased(), "thistle",
        "timber", "topaz", "torrent", "valley", "velvet", "vermilion", "VOYAGE".lowercased(), "willow",
        "zephyr", "zenith",
    ]

    static func generate(
        mode: VowkeyGeneratorMode,
        length: Int = 20,
        includeUppercase: Bool = true,
        includeLowercase: Bool = true,
        includeDigits: Bool = true,
        includeSymbols: Bool = true,
        wordCount: Int = 4,
        separator: String = "-",
        pinLength: Int = 6,
    ) -> String {
        switch mode {
        case .password:
            var alphabet = ""
            if includeLowercase { alphabet += "abcdefghijkmnopqrstuvwxyz" }
            if includeUppercase { alphabet += "ABCDEFGHJKLMNPQRSTUVWXYZ" }
            if includeDigits { alphabet += "23456789" }
            if includeSymbols { alphabet += "!@#$%^&*()-_=+" }
            if alphabet.isEmpty { alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789" }
            let chars = Array(alphabet)
            let clamped = min(max(length, 8), 64)
            return String((0 ..< clamped).map { _ in chars[secureRandomIndex(upperBound: chars.count)] })
        case .passphrase:
            let count = min(max(wordCount, 3), 8)
            let chosen = (0 ..< count).map { _ in words[secureRandomIndex(upperBound: words.count)] }
            let suffix = secureRandomIndex(upperBound: 90) + 10
            return chosen.joined(separator: separator) + separator + String(suffix)
        case .pin:
            let digits = Array("0123456789")
            let count = min(max(pinLength, 4), 12)
            return String((0 ..< count).map { _ in digits[secureRandomIndex(upperBound: digits.count)] })
        }
    }

    private static func secureRandomIndex(upperBound: Int) -> Int {
        guard upperBound > 1 else { return 0 }
        var randomValue: UInt32 = 0
        _ = withUnsafeMutableBytes(of: &randomValue) { buffer in
            SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!)
        }
        return Int(randomValue % UInt32(upperBound))
    }
}

private extension String {
    var nilIfBlank: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}
