import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VowkeyKit
import VowkeyResources
import VowkeySdk

// swiftlint:disable file_length

// MARK: - VowkeyVaultTabView

struct VowkeyVaultTabView: View {
    // MARK: Properties

    @ObservedObject var model: VowkeyWorkspaceModel

    @SwiftUI.State private var copiedItemId: String?
    @SwiftUI.State private var editorKind: VowkeyItemKind?
    @SwiftUI.State private var isScanningDocument = false
    @SwiftUI.State private var isShowingFileImporter = false
    @SwiftUI.State private var isShowingFillSheet = false
    @SwiftUI.State private var isShowingPhotoPicker = false

    private static var supportedDocumentTypes: [UTType] {
        var types: [UTType] = [.pdf, .image]
        for ext in ["docx", "xlsx", "hwpx"] {
            if let docType = UTType(filenameExtension: ext) {
                types.append(docType)
            }
        }
        return types
    }

    // MARK: Body

    var body: some View {
        Group {
            if model.activeCiphers.isEmpty {
                emptyVaultBody
            } else {
                populatedVaultBody
                    .searchable(
                        text: $model.searchQuery,
                        placement: .navigationBarDrawer(displayMode: .always),
                        prompt: "Search profiles, documents, logins, keys",
                    )
            }
        }
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .navigationBar(title: VowkeyMobileTheme.tr("Vault", "Vault"), titleDisplayMode: .inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                if !model.isSignedIn, model.profiles.isEmpty {
                    signInToolbarButton
                }
            }
        }
        .vowkeyWorkspaceToolbar(
            showFillForm: !model.profiles.isEmpty,
            fillAccessibilityId: "VaultFillFormButton",
            onFillForm: { isShowingFillSheet = true },
            trailing: {
                HStack(spacing: 14) {
                    if !model.isSignedIn, !model.profiles.isEmpty {
                        signInToolbarButton
                    }
                    addMenu
                }
            },
        )
        .sheet(isPresented: $isShowingPhotoPicker) {
            VowkeyPhotoLibraryPicker { data in
                Task {
                    _ = await model.captureDocumentFile(
                        data: data,
                        fileName: "document-photo.jpg",
                        mediaType: "image/jpeg",
                    )
                }
            }
        }
        .fileImporter(
            isPresented: $isShowingFileImporter,
            allowedContentTypes: Self.supportedDocumentTypes,
        ) { result in
            guard case let .success(url) = result else { return }
            let accessed = url.startAccessingSecurityScopedResource()
            defer { if accessed { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            let mime = VowkeyWorkspaceModel.mediaType(for: url)
            Task {
                _ = await model.captureDocumentFile(
                    data: data,
                    fileName: url.lastPathComponent,
                    mediaType: mime,
                )
            }
        }
        .fullScreenCover(isPresented: $isScanningDocument) {
            DocumentScannerView(
                onFinish: { scan in
                    isScanningDocument = false
                    if scan.pageCount == 1,
                       let jpegData = VowkeyMobileTheme.normalizedPhotoJPEGData(scan.imageOfPage(at: 0)) {
                        Task {
                            _ = await model.captureDocumentFile(
                                data: jpegData,
                                fileName: "scanned-document.jpg",
                                mediaType: "image/jpeg",
                            )
                        }
                    } else if let pdfData = scan.documentPDF() {
                        Task {
                            _ = await model.captureDocumentFile(
                                data: pdfData,
                                fileName: "scanned-document.pdf",
                                mediaType: "application/pdf",
                            )
                        }
                    }
                },
                onCancel: { isScanningDocument = false },
                onFailure: { _ in isScanningDocument = false },
            )
        }
        .sheet(item: $editorKind) { kind in
            VowkeyItemEditorSheet(model: model, initialKind: kind)
        }
        .sheet(isPresented: $isShowingFillSheet) {
            VowkeyFillFormSheet(model: model, preselectedProfileId: nil)
        }
    }

    private var signInToolbarButton: some View {
        Button {
            model.onSignInRequested()
        } label: {
            Text("Sign in")
                .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                .foregroundColor(VowkeyMobileTheme.blue)
        }
        .accessibilityIdentifier("VaultToolbarSignInButton")
    }

    // MARK: Empty Walkthrough

    private var emptyVaultBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !model.isSignedIn {
                    DemoDayBannerView {
                        DemoAccount.autoSignInPending = true
                        model.onSignInRequested()
                    }
                }
                if model.isBusy {
                    busyBanner
                }
                if let banner = model.bannerMessage {
                    statusBanner(banner)
                }

                VowkeyGroupedCard {
                    VStack(alignment: .leading, spacing: 20) {
                        Image(decorative: Asset.Images.logo)
                            .renderingMode(.original)
                            .resizable()
                            .scaledToFit()
                            .frame(height: 28)

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Save once, fill any form")
                                .styleGuide(.title2, weight: .semibold, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                                .fixedSize(horizontal: false, vertical: true)

                            Text("Add a document, check its details, and use them to fill your next form.")
                                .styleGuide(.body, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }

                        VStack(spacing: 10) {
                            Menu {
                                if model.hasDocumentCamera {
                                    Button {
                                        Task {
                                            if await model.requestCameraAccess() {
                                                isScanningDocument = true
                                            }
                                        }
                                    } label: {
                                        Label(Localizations.vowkeyScanDocument, systemImage: "camera.viewfinder")
                                    }
                                }

                                Button {
                                    isShowingPhotoPicker = true
                                } label: {
                                    Label(Localizations.vowkeyChoosePhoto, systemImage: "photo.on.rectangle")
                                }

                                Button {
                                    isShowingFileImporter = true
                                } label: {
                                    Label("Choose PDF or Office file", systemImage: "folder")
                                }
                            } label: {
                                VowkeyPrimaryActionLabel(
                                    title: "Add a document",
                                    icon: SharedAsset.Icons.fileUpload24,
                                )
                            }
                            .accessibilityIdentifier("VaultEmptyAddDocumentButton")

                            Menu {
                                ForEach(VowkeySampleWalkthrough.scenarios) { scenario in
                                    Button(scenario.pickerLabel) {
                                        Task { await model.loadSampleScenario(scenario) }
                                    }
                                    .accessibilityIdentifier("SampleScenario_\(scenario.id)")
                                }
                                Divider()
                                Button("Load all samples") {
                                    Task { await model.loadAllSamples() }
                                }
                                .accessibilityIdentifier("VaultTryAllSamplesButton")
                            } label: {
                                Text("Try sample documents")
                            }
                            .buttonStyle(.secondary())
                            .accessibilityIdentifier("VaultSampleDocumentsMenu")
                        }
                        .disabled(model.isBusy)
                    }
                    .padding(24)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 24)
        }
    }

    // MARK: Populated Vault

    private var populatedVaultBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if !model.isSignedIn {
                    DemoDayBannerView {
                        DemoAccount.autoSignInPending = true
                        model.onSignInRequested()
                    }
                }
                if model.isBusy {
                    busyBanner
                }
                if let banner = model.bannerMessage {
                    statusBanner(banner)
                }
                if model.hasSampleData {
                    sampleBanner
                }

                filterAndSortBar

                let rows = model.filteredRows
                if rows.isEmpty {
                    VowkeyGroupedCard {
                        VStack(spacing: 8) {
                            Text("No matching items")
                                .styleGuide(.bodySemibold, weight: .semibold, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                            Text("Try another search term or switch back to All.")
                                .styleGuide(.callout, includeLinePadding: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                            if model.selectedFilter != .all || !model.searchQuery.isEmpty {
                                Button("Reset filter") {
                                    model.selectedFilter = .all
                                    model.searchQuery = ""
                                }
                                .styleGuide(.calloutSemibold, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.blue)
                                .padding(.top, 2)
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(22)
                    }
                } else {
                    VowkeyGroupedCard {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            vaultRow(row)
                            if index < rows.count - 1 {
                                Divider()
                                    .padding(.leading, 68)
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 88)
        }
        .refreshable {
            await model.syncNow()
        }
    }

    private var sampleBanner: some View {
        VowkeyGroupedCard {
            HStack(spacing: 10) {
                VowkeySampleTag(text: "Sample data")

                Spacer(minLength: 4)

                Button("Remove") {
                    Task { await model.clearSampleData() }
                }
                .styleGuide(.subheadlineSemibold, includeLinePadding: false, includeLineSpacing: false)
                .foregroundColor(VowkeyMobileTheme.red)
                .buttonStyle(.plain)
                .accessibilityIdentifier("VaultClearSamplesButton")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
    }

    private var filterAndSortBar: some View {
        let chipShape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return HStack(spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(model.visibleFilterChips) { chip in
                        let isSelected = model.selectedFilter == chip
                        Button {
                            model.selectedFilter = chip
                        } label: {
                            Text(chip.filterTitle)
                                .styleGuide(
                                    isSelected ? .calloutSemibold : .callout,
                                    weight: isSelected ? .semibold : .regular,
                                    includeLinePadding: false,
                                    includeLineSpacing: false,
                                )
                                .foregroundColor(
                                    isSelected
                                        ? SharedAsset.Colors.buttonFilledForeground.swiftUIColor
                                        : VowkeyMobileTheme.ink,
                                )
                                .padding(.horizontal, 12)
                                .padding(.vertical, 7)
                                .background(
                                    chipShape
                                        .fill(
                                            isSelected
                                                ? SharedAsset.Colors.buttonFilledBackground.swiftUIColor
                                                : VowkeyMobileTheme.surface,
                                        ),
                                )
                                .overlay(
                                    chipShape
                                        .strokeBorder(isSelected ? Color.clear : VowkeyMobileTheme.line, lineWidth: 1),
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("FilterChip_\(chip.rawValue)")
                    }
                }
                .padding(.vertical, 1)
            }

            Menu {
                Picker("Sort by", selection: $model.sortOrder) {
                    ForEach(VowkeySortOrder.allCases) { order in
                        Text(order.title).tag(order)
                    }
                }
            } label: {
                Image(systemName: "arrow.up.arrow.down")
                    .font(.footnote.weight(.semibold))
                    .foregroundColor(VowkeyMobileTheme.iconPrimary)
                    .frame(width: 34, height: 34)
                    .background(chipShape.fill(VowkeyMobileTheme.surface))
                    .overlay(chipShape.strokeBorder(VowkeyMobileTheme.line, lineWidth: 1))
            }
            .accessibilityLabel("Sort")
        }
    }

    @ViewBuilder
    private func vaultRow(_ row: VowkeyVaultRowItem) -> some View {
        switch row {
        case let .cipher(cipher):
            cipherRow(cipher)
        case let .document(entry):
            NavigationLink {
                VowkeyDocumentDetailView(model: model, entry: entry)
            } label: {
                HStack(spacing: 14) {
                    VowkeySourceThumbnailView(
                        model: model,
                        cipherId: entry.cipherId,
                        attachmentId: entry.attachmentId,
                        size: CGSize(width: 44, height: 32),
                    )
                    VStack(alignment: .leading, spacing: 2) {
                        Text(VowkeyMobileTheme.displayName(entry.displayTitle))
                            .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.ink)
                            .lineLimit(1)
                        Text([entry.profileName, entry.expiryBadgeText].compactMap(\.self).joined(separator: " · "))
                            .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.muted)
                            .lineLimit(1)
                    }
                    Spacer()
                    SharedAsset.Icons.chevronRight16.swiftUIImage
                        .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 14)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
    }

    private func cipherRow(_ cipher: CipherView) -> some View {
        let cipherId = cipher.id ?? cipher.name
        let kind = VowkeyWorkspaceModel.itemKind(for: cipher)
        let quickCopy = Self.quickCopyValue(for: cipher)
        let isSample = VowkeyWorkspaceModel.isSampleCipher(cipher)
        let title = isSample ? VowkeyMobileTheme.displayName(cipher.name) : cipher.name

        return HStack(spacing: 10) {
            NavigationLink {
                if kind == .profile {
                    VowkeyProfileDetailView(model: model, cipherId: cipherId)
                } else {
                    VowkeyItemDetailView(model: model, cipherId: cipherId)
                }
            } label: {
                HStack(spacing: 14) {
                    if kind == .profile {
                        VowkeyMonogramTile(name: title, seed: cipherId, size: 38)
                    } else {
                        VowkeyKindTile(kind: kind, size: 38)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(title)
                                .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                                .lineLimit(1)
                            if cipher.favorite {
                                SharedAsset.Icons.starFilled24.swiftUIImage
                                    .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.blue))
                            }
                            if isSample {
                                VowkeySampleTag()
                            }
                        }

                        Text(
                            copiedItemId == cipherId
                                ? VowkeyMobileTheme.copiedText
                                : VowkeyWorkspaceModel.subtitle(for: cipher),
                        )
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(copiedItemId == cipherId ? VowkeyMobileTheme.green : VowkeyMobileTheme.muted)
                        .lineLimit(1)
                    }

                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("VaultRow_\(cipher.name)")

            if let quickCopy {
                Button {
                    UIPasteboard.general.string = quickCopy
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    copiedItemId = cipherId
                    Task {
                        try? await Task.sleep(nanoseconds: 1_300_000_000)
                        if copiedItemId == cipherId { copiedItemId = nil }
                    }
                } label: {
                    (copiedItemId == cipherId ? SharedAsset.Icons.check16 : SharedAsset.Icons.copy16).swiftUIImage
                        .imageStyle(
                            .accessoryIcon16(
                                color: copiedItemId == cipherId ? VowkeyMobileTheme.green : VowkeyMobileTheme.iconPrimary,
                            ),
                        )
                        .frame(width: 30, height: 30)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Localizations.copy)
            }

            SharedAsset.Icons.chevronRight16.swiftUIImage
                .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .contextMenu {
            Button {
                Task { await model.togglePin(cipher) }
            } label: {
                Label(cipher.favorite ? "Unpin" : "Pin to top", systemImage: cipher.favorite ? "pin.slash" : "pin")
            }

            Button(role: .destructive) {
                Task { await model.softDelete(cipher) }
            } label: {
                Label("Move to recently deleted", systemImage: "trash")
            }
        }
    }

    // MARK: Menus & Banners

    private var addMenu: some View {
        Menu {
            Section("Documents & profiles") {
                if model.hasDocumentCamera {
                    Button {
                        Task {
                            if await model.requestCameraAccess() {
                                isScanningDocument = true
                            }
                        }
                    } label: {
                        Label(Localizations.vowkeyScanDocument, systemImage: "camera.viewfinder")
                    }
                }

                Button {
                    isShowingPhotoPicker = true
                } label: {
                    Label(Localizations.vowkeyChoosePhoto, systemImage: "photo.on.rectangle")
                }

                Button {
                    isShowingFileImporter = true
                } label: {
                    Label("Choose PDF or Office file", systemImage: "folder")
                }

                Button {
                    editorKind = .profile
                } label: {
                    Label("New profile", systemImage: "person.crop.circle.badge.plus")
                }
            }

            Section("Vault items") {
                Button {
                    editorKind = .login
                } label: {
                    Label("New login", systemImage: "globe")
                }

                Button {
                    editorKind = .card
                } label: {
                    Label("New card", systemImage: "creditcard")
                }

                Button {
                    editorKind = .key
                } label: {
                    Label("New API key", systemImage: "key")
                }

                Button {
                    editorKind = .note
                } label: {
                    Label("New note", systemImage: "note.text.badge.plus")
                }
            }

            Section("Sample walkthrough") {
                if model.hasSampleData {
                    Button(role: .destructive) {
                        Task { await model.clearSampleData() }
                    } label: {
                        Label("Remove sample data", systemImage: "trash")
                    }
                } else {
                    Button {
                        Task { await model.loadAllSamples() }
                    } label: {
                        Label("Try sample documents", systemImage: "sparkles")
                    }
                }
            }
        } label: {
            SharedAsset.Icons.plus24.swiftUIImage
                .imageStyle(.toolbarIcon)
        }
        .accessibilityLabel("Add")
        .accessibilityIdentifier("VaultAddMenuButton")
    }

    private var busyBanner: some View {
        VowkeyGroupedCard {
            HStack(spacing: 12) {
                ProgressView()
                Text(model.busyLabel ?? Localizations.loading)
                    .styleGuide(.calloutSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.ink)
                Spacer()
            }
            .padding(14)
        }
    }

    private func statusBanner(_ text: String) -> some View {
        let isError = model.isBannerError
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        return HStack(spacing: 10) {
            if isError {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.callout.weight(.semibold))
                    .foregroundColor(VowkeyMobileTheme.red)
            } else {
                SharedAsset.Icons.checkCircle24.swiftUIImage
                    .imageStyle(.accessoryIcon24(color: VowkeyMobileTheme.green))
            }
            Text(text)
                .styleGuide(.callout, weight: .medium, includeLinePadding: false)
                .foregroundColor(isError ? VowkeyMobileTheme.red : VowkeyMobileTheme.ink)
            Spacer()
            Button {
                model.dismissBanner()
            } label: {
                SharedAsset.Icons.close16.swiftUIImage
                    .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(isError ? VowkeyMobileTheme.redSoft : VowkeyMobileTheme.surface)
        .clipShape(shape)
        .overlay(
            shape.strokeBorder(isError ? VowkeyMobileTheme.redBorder : VowkeyMobileTheme.line, lineWidth: 1),
        )
    }

    private static func quickCopyValue(for cipher: CipherView) -> String? {
        switch cipher.type {
        case .apiKey:
            cipher.id.map { "@vk:\($0)/key.value" }
        case .login:
            cipher.login?.password?.isEmpty == false ? cipher.login?.password : cipher.login?.username
        default:
            nil
        }
    }
}
