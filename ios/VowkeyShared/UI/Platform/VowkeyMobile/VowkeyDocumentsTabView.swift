import Photos
import QuickLook
import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VowkeyKit
import VowkeyResources
import VowkeySdk

// swiftlint:disable file_length

// MARK: - VowkeyDocumentsTabView

struct VowkeyDocumentsTabView: View {
    // MARK: Properties

    @ObservedObject var model: VowkeyWorkspaceModel

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
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if model.isBusy {
                    busyBanner
                }

                if let banner = model.bannerMessage {
                    statusBanner(banner)
                }

                if model.documents.isEmpty {
                    emptyDocumentsCard
                } else {
                    VStack(alignment: .leading, spacing: 8) {
                        VowkeySectionHeader("Saved documents")
                        VowkeyGroupedCard {
                            ForEach(Array(model.documents.enumerated()), id: \.element.id) { index, entry in
                                NavigationLink {
                                    VowkeyDocumentDetailView(model: model, entry: entry)
                                } label: {
                                    documentRow(entry)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("DocumentRow_\(index)")

                                if index < model.documents.count - 1 {
                                    Divider().padding(.leading, 82)
                                }
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 88)
        }
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .navigationBar(title: VowkeyMobileTheme.tr("VowkeyDocuments", "Documents"), titleDisplayMode: .inline)
        .vowkeyWorkspaceToolbar(
            showFillForm: !model.profiles.isEmpty,
            fillAccessibilityId: "DocumentsTabFillFormButton",
            onFillForm: { isShowingFillSheet = true },
            trailing: { addDocumentMenu },
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
                       let jpeg = VowkeyMobileTheme.normalizedPhotoJPEGData(scan.imageOfPage(at: 0)) {
                        Task {
                            _ = await model.captureDocumentFile(
                                data: jpeg,
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
        .sheet(isPresented: $isShowingFillSheet) {
            VowkeyFillFormSheet(model: model, preselectedProfileId: nil)
        }
    }

    // MARK: Private Views

    private var addDocumentMenu: some View {
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

            if !model.hasSampleData {
                Divider()
                Button {
                    Task { await model.loadAllSamples() }
                } label: {
                    Label("Try sample documents", systemImage: "sparkles")
                }
            }
        } label: {
            SharedAsset.Icons.plus24.swiftUIImage
                .imageStyle(.accessoryIcon24(color: VowkeyMobileTheme.blue))
        }
        .accessibilityIdentifier("DocumentsAddMenuButton")
    }

    private var busyBanner: some View {
        VowkeyGroupedCard {
            HStack(spacing: 12) {
                ProgressView()
                Text(model.busyLabel ?? Localizations.loading)
                    .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
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

    private var emptyDocumentsCard: some View {
        VowkeyGroupedCard {
            VStack(alignment: .leading, spacing: 16) {
                VowkeyKindTile(kind: .document, size: 44)

                VStack(alignment: .leading, spacing: 6) {
                    Text("Scan or import your first document")
                        .styleGuide(.title, weight: .bold)
                        .foregroundColor(VowkeyMobileTheme.ink)

                    Text("Add a passport, ID card, residence card, or form. Vowkey extracts the details into a reusable profile and keeps the original page ready to inspect.")
                        .styleGuide(.callout)
                        .foregroundColor(VowkeyMobileTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

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
                .accessibilityIdentifier("DocumentsEmptyAddButton")

                Button("Try sample documents") {
                    Task { await model.loadAllSamples() }
                }
                .buttonStyle(.secondary(size: .medium))
                .accessibilityIdentifier("DocumentsEmptyTrySamplesButton")
            }
            .padding(20)
        }
    }

    private func documentRow(_ entry: VowkeyDocumentEntry) -> some View {
        HStack(spacing: 12) {
            VowkeySourceThumbnailView(
                model: model,
                cipherId: entry.cipherId,
                attachmentId: entry.attachmentId,
                size: CGSize(width: 56, height: 40),
            )

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(entry.displayTitle)
                        .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.ink)
                        .lineLimit(1)
                    if entry.isSample {
                        VowkeySampleTag()
                    }
                }

                HStack(spacing: 6) {
                    Text(entry.profileName)
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                        .lineLimit(1)
                    if let badge = entry.expiryBadgeText {
                        Text("· \(badge)")
                            .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(
                                entry.isExpired
                                    ? VowkeyMobileTheme.red
                                    : (entry.isExpiringSoon ? VowkeyMobileTheme.amber : VowkeyMobileTheme.muted),
                            )
                            .lineLimit(1)
                    }
                }
            }

            Spacer()

            SharedAsset.Icons.chevronRight16.swiftUIImage
                .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - VowkeyDocumentDetailView

struct VowkeyDocumentDetailView: View {
    @ObservedObject var model: VowkeyWorkspaceModel
    let entry: VowkeyDocumentEntry

    @SwiftUI.State private var copiedId: String?
    @SwiftUI.State private var didFinishLoadingImage = false
    @SwiftUI.State private var exportURL: URL?
    @SwiftUI.State private var isShowingExportShare = false
    @SwiftUI.State private var isShowingFullSheet = false
    @SwiftUI.State private var pageImage: UIImage?
    @SwiftUI.State private var selectedDetailId: String?

    private var cipher: CipherView? {
        model.cipher(withId: entry.cipherId)
    }

    private var extractedDetails: [[String: Any]] {
        guard let cipher else { return [] }
        let all = NativeProfile.details(cipher)
        let matching = all.filter { NativeProfile.sourceId(for: $0) == entry.sourceId }
        return matching.isEmpty ? all : matching
    }

    private var selectedDetail: [String: Any]? {
        if let selectedDetailId {
            return extractedDetails.first { ($0["id"] as? String) == selectedDetailId }
        }
        return extractedDetails.first { NativeProfile.locator(for: $0) != nil } ?? extractedDetails.first
    }

    var body: some View {
        ScrollViewReader { scrollProxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    previewCard
                        .id("DocumentPreviewAnchor")

                    metadataCard

                    if !extractedDetails.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            VowkeySectionHeader("Extracted details")
                            VowkeyGroupedCard {
                                ForEach(Array(extractedDetails.enumerated()), id: \.offset) { idx, detail in
                                    let detailId = (detail["id"] as? String) ?? "\(idx)"
                                    let label = (detail["label"] as? String) ?? "Detail"
                                    let value = NativeProfile.value(detail) ?? ""
                                    let isSelected = detailId == (selectedDetail?["id"] as? String)

                                    HStack(spacing: 10) {
                                        Button {
                                            withAnimation(.spring(response: 0.28, dampingFraction: 0.84)) {
                                                selectedDetailId = detailId
                                                scrollProxy.scrollTo("DocumentPreviewAnchor", anchor: .top)
                                            }
                                        } label: {
                                            HStack(spacing: 10) {
                                                Image(systemName: isSelected ? "largecircle.fill.circle" : "circle")
                                                    .font(.footnote.weight(.semibold))
                                                    .foregroundColor(isSelected ? VowkeyMobileTheme.blue : VowkeyMobileTheme.muted)
                                                VStack(alignment: .leading, spacing: 2) {
                                                    Text(label)
                                                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                                        .foregroundColor(VowkeyMobileTheme.muted)
                                                    Text(value)
                                                        .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                                        .foregroundColor(VowkeyMobileTheme.ink)
                                                        .lineLimit(2)
                                                }
                                                Spacer()
                                            }
                                        }
                                        .buttonStyle(.plain)

                                        Button {
                                            UIPasteboard.general.string = value
                                            copiedId = detailId
                                            Task {
                                                try? await Task.sleep(nanoseconds: 1_200_000_000)
                                                if copiedId == detailId { copiedId = nil }
                                            }
                                        } label: {
                                            (copiedId == detailId ? SharedAsset.Icons.check16 : SharedAsset.Icons.copy16)
                                                .swiftUIImage
                                                .imageStyle(
                                                    .accessoryIcon16(
                                                        color: copiedId == detailId ? VowkeyMobileTheme.green : VowkeyMobileTheme.blue,
                                                    ),
                                                )
                                                .frame(width: 30, height: 30)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 11)
                                    .background(isSelected ? VowkeyMobileTheme.blueSoft.opacity(0.45) : Color.clear)

                                    if idx < extractedDetails.count - 1 {
                                        Divider().padding(.leading, 40)
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 88)
            }
        }
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .navigationBar(title: entry.displayTitle, titleDisplayMode: .inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                if exportURL != nil {
                    Button {
                        isShowingExportShare = true
                    } label: {
                        SharedAsset.Icons.share16.swiftUIImage
                            .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.iconPrimary))
                    }
                }
            }
        }
        .sheet(isPresented: $isShowingExportShare) {
            if let exportURL {
                VowkeyShareSheet(items: [exportURL])
            }
        }
        .sheet(isPresented: $isShowingFullSheet) {
            if let cipher {
                VowkeyDocumentHighlightSheet(
                    model: model,
                    cipher: cipher,
                    initialAttachmentId: entry.attachmentId,
                    initialDetailId: selectedDetail?["id"] as? String,
                )
            }
        }
        .task(id: entry.id) {
            didFinishLoadingImage = false
            pageImage = await model.loadSourcePageImage(
                cipherId: entry.cipherId,
                attachmentId: entry.attachmentId,
                pageIndex: 0,
                maxDimension: 1400,
            )
            didFinishLoadingImage = true
            if let bytes = await model.rawAttachmentBytes(cipherId: entry.cipherId, attachmentId: entry.attachmentId) {
                let safeName = entry.fileName.isEmpty ? "document.png" : entry.fileName
                let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent(safeName)
                try? bytes.write(to: tempURL, options: .atomic)
                exportURL = tempURL
            }
        }
    }

    private var previewCard: some View {
        VowkeyGroupedCard {
            VStack(spacing: 10) {
                GeometryReader { proxy in
                    ZStack {
                        if let pageImage {
                            let availWidth = max(1, proxy.size.width)
                            let availHeight = max(1, proxy.size.height)
                            let scale = min(availWidth / pageImage.size.width, availHeight / pageImage.size.height)
                            let drawWidth = pageImage.size.width * scale
                            let drawHeight = pageImage.size.height * scale

                            ZStack(alignment: .topLeading) {
                                Image(uiImage: pageImage)
                                    .resizable()
                                    .frame(width: drawWidth, height: drawHeight)
                                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                                if let selectedDetail,
                                   let loc = NativeProfile.locator(for: selectedDetail),
                                   let normX = (loc["x"] as? Double) ?? (loc["x"] as? NSNumber)?.doubleValue,
                                   let normY = (loc["y"] as? Double) ?? (loc["y"] as? NSNumber)?.doubleValue,
                                   let normW = (loc["w"] as? Double) ?? (loc["w"] as? NSNumber)?.doubleValue,
                                   let normH = (loc["h"] as? Double) ?? (loc["h"] as? NSNumber)?.doubleValue {
                                    let pad: CGFloat = 3
                                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                                        .fill(VowkeyMobileTheme.blue.opacity(0.16))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                                .stroke(VowkeyMobileTheme.blue, lineWidth: 2.2),
                                        )
                                        .frame(
                                            width: max(20, CGFloat(normW) * drawWidth + pad * 2),
                                            height: max(16, CGFloat(normH) * drawHeight + pad * 2),
                                        )
                                        .offset(
                                            x: CGFloat(normX) * drawWidth - pad,
                                            y: CGFloat(normY) * drawHeight - pad,
                                        )
                                }
                            }
                        } else if didFinishLoadingImage {
                            VStack(spacing: 8) {
                                VowkeyKindTile(kind: .document, size: 46)
                                Text(entry.displayTitle)
                                    .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.ink)
                                Text("Original image not stored on this item")
                                    .styleGuide(.caption1, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.muted)
                            }
                        } else {
                            ProgressView()
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .contentShape(Rectangle())
                    .onTapGesture {
                        if pageImage != nil {
                            isShowingFullSheet = true
                        }
                    }
                }
                .frame(height: 230)

                HStack {
                    Text(entry.fileName)
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                        .lineLimit(1)
                    Spacer()
                    Button {
                        isShowingFullSheet = true
                    } label: {
                        HStack(spacing: 5) {
                            Image(systemName: "arrow.up.left.and.arrow.down.right")
                                .font(.caption2.weight(.semibold))
                            Text("Zoom & inspect")
                                .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                        }
                        .foregroundColor(VowkeyMobileTheme.blue)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(14)
        }
    }

    private var metadataCard: some View {
        VowkeyGroupedCard {
            VStack(spacing: 0) {
                NavigationLink {
                    VowkeyProfileDetailView(model: model, cipherId: entry.cipherId)
                } label: {
                    HStack(spacing: 12) {
                        VowkeyMonogramTile(name: entry.profileName, seed: entry.cipherId, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Owner profile")
                                .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                            Text(entry.profileName)
                                .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                        }
                        Spacer()
                        SharedAsset.Icons.chevronRight16.swiftUIImage
                            .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 12)
                }
                .buttonStyle(.plain)

                if let badge = entry.expiryBadgeText {
                    Divider().padding(.leading, 14)
                    HStack {
                        Text("Validity")
                            .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.muted)
                        Spacer()
                        Text(badge)
                            .styleGuide(.callout, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(
                                entry.isExpired
                                    ? VowkeyMobileTheme.red
                                    : (entry.isExpiringSoon ? VowkeyMobileTheme.amber : VowkeyMobileTheme.ink),
                            )
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 11)
                }
            }
        }
    }
}

// MARK: - VowkeyFillFormSheet

struct VowkeyFillFormSheet: View {
    @ObservedObject var model: VowkeyWorkspaceModel
    let preselectedProfileId: String?

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var chosenProfileId = ""
    @SwiftUI.State private var isScanningForm = false
    @SwiftUI.State private var isShowingFileImporter = false
    @SwiftUI.State private var isShowingPhotoPicker = false
    @SwiftUI.State private var isShowingQuickLook = false
    @SwiftUI.State private var isShowingShareFilled = false
    @SwiftUI.State private var isShowingZoomSheet = false

    private static var supportedFormTypes: [UTType] {
        var types: [UTType] = [.pdf, .image]
        for ext in ["docx", "xlsx", "hwpx"] {
            if let itemType = UTType(filenameExtension: ext) {
                types.append(itemType)
            }
        }
        return types
    }

    private var shareButtonTitle: String {
        if model.filledMediaType.hasPrefix("image/") {
            return "Share filled image"
        }
        if model.filledMediaType == "application/pdf" {
            return Localizations.vowkeyShareFilledPdf
        }
        return "Share filled document"
    }

    var body: some View {
        NavigationView {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if model.profiles.isEmpty {
                        VowkeyGroupedCard {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("Add a profile or sample document first")
                                    .styleGuide(.title2, weight: .semibold)
                                    .foregroundColor(VowkeyMobileTheme.ink)
                                Text("Vowkey fills photographed paper forms, PDFs, and Office documents from your saved profiles.")
                                    .styleGuide(.callout)
                                    .foregroundColor(VowkeyMobileTheme.muted)
                            }
                            .padding(16)
                        }
                    } else {
                        profilePickerSection
                            .disabled(model.isBusy)
                        if model.isBusy {
                            VowkeyGroupedCard {
                                HStack(spacing: 12) {
                                    ProgressView()
                                    Text(model.busyLabel ?? "Matching fields and placing text…")
                                        .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                        .foregroundColor(VowkeyMobileTheme.ink)
                                    Spacer()
                                }
                                .padding(14)
                            }
                        }
                        if let error = model.fillErrorMessage {
                            VowkeyGroupedCard {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(error)
                                        .styleGuide(.body, includeLinePadding: false)
                                        .foregroundColor(VowkeyMobileTheme.red)
                                    Button("Try again") {
                                        Task { await model.refillLastForm(profileId: chosenProfileId) }
                                    }
                                    .buttonStyle(.secondary(size: .medium))
                                    .disabled(model.isBusy)
                                }
                                .padding(16)
                            }
                            .accessibilityIdentifier("FillSheetError")
                        }
                        if let outputURL = model.filledOutputURL {
                            filledResultSection(outputURL: outputURL)
                        }
                        formSourceSection
                            .disabled(model.isBusy)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 36)
            }
            .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
            .navigationBar(title: VowkeyMobileTheme.tr("VowkeyFillForm", "Fill form"), titleDisplayMode: .inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.close) { dismiss() }
                        .foregroundColor(VowkeyMobileTheme.blue)
                }
            }
            .onAppear {
                chosenProfileId = preselectedProfileId ?? model.selectedProfileId
                if chosenProfileId.isEmpty {
                    chosenProfileId = model.profiles.first?.id ?? ""
                }
            }
            .sheet(isPresented: $isShowingPhotoPicker) {
                VowkeyPhotoLibraryPicker { data in
                    Task {
                        await model.fillFormFile(
                            data: data,
                            fileName: "photo-form.jpg",
                            profileId: chosenProfileId,
                        )
                    }
                }
            }
            .sheet(isPresented: $isShowingShareFilled) {
                if let outputURL = model.filledOutputURL {
                    VowkeyShareSheet(items: [outputURL])
                }
            }
            .sheet(isPresented: $isShowingQuickLook) {
                if let outputURL = model.filledOutputURL {
                    VowkeyQuickLookSheet(url: outputURL)
                }
            }
            .fullScreenCover(isPresented: $isShowingZoomSheet) {
                if let filled = model.filledPreviewImage {
                    VowkeyFilledFormZoomSheet(
                        filledImage: filled,
                        originalImage: model.originalFormPreviewImage,
                        outputURL: model.filledOutputURL,
                        canSaveToPhotos: model.filledMediaType.hasPrefix("image/"),
                    )
                }
            }
            .fileImporter(
                isPresented: $isShowingFileImporter,
                allowedContentTypes: Self.supportedFormTypes,
            ) { result in
                guard case let .success(url) = result else { return }
                let accessed = url.startAccessingSecurityScopedResource()
                defer { if accessed { url.stopAccessingSecurityScopedResource() } }
                guard let data = try? Data(contentsOf: url) else { return }
                Task {
                    await model.fillFormFile(
                        data: data,
                        fileName: url.lastPathComponent,
                        profileId: chosenProfileId,
                    )
                }
            }
            .fullScreenCover(isPresented: $isScanningForm) {
                DocumentScannerView(
                    onFinish: { scan in
                        isScanningForm = false
                        if scan.pageCount == 1,
                           let jpeg = VowkeyMobileTheme.normalizedPhotoJPEGData(scan.imageOfPage(at: 0)) {
                            Task {
                                await model.fillFormFile(
                                    data: jpeg,
                                    fileName: "scanned-form.jpg",
                                    profileId: chosenProfileId,
                                )
                            }
                        } else if let pdf = scan.documentPDF() {
                            Task {
                                await model.fillFormFile(
                                    data: pdf,
                                    fileName: "scanned-form.pdf",
                                    profileId: chosenProfileId,
                                )
                            }
                        }
                    },
                    onCancel: { isScanningForm = false },
                    onFailure: { _ in isScanningForm = false },
                )
            }
        }
    }

    private var profilePickerSection: some View {
        let chipShape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader(Localizations.vowkeyWhoseDetails)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(model.profiles, id: \.id) { profile in
                        let profileId = profile.id ?? ""
                        let isSelected = profileId == chosenProfileId
                        Button {
                            let changed = chosenProfileId != profileId
                            chosenProfileId = profileId
                            model.selectedProfileId = profileId
                            if changed, model.hasLoadedFormToRefill, !model.isBusy {
                                Task {
                                    await model.refillLastForm(profileId: profileId)
                                }
                            }
                        } label: {
                            Text(VowkeyMobileTheme.displayName(profile.name))
                                .styleGuide(.callout, weight: isSelected ? .semibold : .medium, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(isSelected ? VowkeyMobileTheme.blueInk : VowkeyMobileTheme.ink)
                                .lineLimit(1)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 8)
                                .background(
                                    chipShape.fill(isSelected ? VowkeyMobileTheme.blueSoft : VowkeyMobileTheme.surface),
                                )
                                .overlay(
                                    chipShape.strokeBorder(
                                        isSelected ? VowkeyMobileTheme.blueSoftBorder : VowkeyMobileTheme.line,
                                        lineWidth: 1,
                                    ),
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("FillProfileChip_\(profile.name)")
                        .accessibilityAddTraits(isSelected ? .isSelected : [])
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 1)
            }
            .padding(.horizontal, -16)
        }
    }

    private var formSourceSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader(model.filledOutputURL == nil ? "Choose a blank form" : "Try another blank form")
            VowkeyGroupedCard {
                VStack(spacing: 0) {
                    if model.hasDocumentCamera {
                        Button {
                            Task {
                                if await model.requestCameraAccess() {
                                    isScanningForm = true
                                }
                            }
                        } label: {
                            actionRow(
                                icon: SharedAsset.Icons.camera24,
                                title: VowkeyMobileTheme.tr("VowkeyScanPaperForm", "Scan paper form"),
                            )
                        }
                        .buttonStyle(.plain)

                        Divider().padding(.leading, 56)
                    }

                    Button {
                        isShowingPhotoPicker = true
                    } label: {
                        actionRow(
                            icon: SharedAsset.Icons.fileUpload24,
                            title: VowkeyMobileTheme.tr("VowkeyChooseFormPhoto", "Choose form photo"),
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("FillSheetChoosePhotoButton")

                    Divider().padding(.leading, 56)

                    Button {
                        isShowingFileImporter = true
                    } label: {
                        actionRow(
                            icon: SharedAsset.Icons.fileText24,
                            title: "Choose a file",
                            subtitle: "PDF, Word, Excel or HWPX",
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("FillSheetChooseFileButton")
                }
            }
        }
    }

    private func filledResultSection(outputURL: URL) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                HStack(spacing: 6) {
                    SharedAsset.Icons.checkCircle24.swiftUIImage
                        .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.green))
                    Text(Localizations.vowkeyFilledXFields(model.filledFieldCount))
                        .styleGuide(.callout, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.green)
                }
                Spacer()
                Button("Clear") {
                    model.clearFilledFormResult()
                }
                .styleGuide(.subheadlineSemibold, includeLinePadding: false, includeLineSpacing: false)
                .foregroundColor(VowkeyMobileTheme.muted)
                .disabled(model.isBusy)
            }
            .padding(.horizontal, 4)

            VowkeyGroupedCard {
                VStack(spacing: 12) {
                    if let preview = model.filledPreviewImage {
                        Button {
                            isShowingZoomSheet = true
                        } label: {
                            ZStack(alignment: .bottomTrailing) {
                                Image(uiImage: preview)
                                    .resizable()
                                    .scaledToFit()
                                    .frame(maxWidth: .infinity, maxHeight: 460)
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .strokeBorder(VowkeyMobileTheme.line, lineWidth: 1),
                                    )

                                HStack(spacing: 5) {
                                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                                        .font(.caption2.weight(.semibold))
                                    Text("View full screen")
                                        .styleGuide(.caption1, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                }
                                .foregroundColor(.white)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(Color.black.opacity(0.72)),
                                )
                                .padding(10)
                            }
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("FillSheetFilledPreviewButton")
                    } else {
                        HStack(spacing: 12) {
                            VowkeyKindTile(kind: .document, size: 40)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(outputURL.lastPathComponent)
                                    .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.ink)
                                    .lineLimit(1)
                                Text("Filled document ready to preview or share")
                                    .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.muted)
                            }
                            Spacer()
                        }
                        .padding(.vertical, 4)
                    }

                    if model.filledMediaType.hasPrefix("image/"), let preview = model.filledPreviewImage {
                        HStack(spacing: 10) {
                            VowkeySavePhotoButton(image: preview)
                                .id(ObjectIdentifier(preview))
                                .accessibilityIdentifier("FillSheetSavePhotosButton")

                            Button {
                                isShowingShareFilled = true
                            } label: {
                                Text(shareButtonTitle)
                            }
                            .buttonStyle(.primary(size: .medium))
                            .accessibilityIdentifier("FillSheetShareFilledButton")
                        }
                    } else if model.filledPreviewImage == nil {
                        HStack(spacing: 10) {
                            Button {
                                isShowingQuickLook = true
                            } label: {
                                Text("Preview document")
                            }
                            .buttonStyle(.secondary(size: .medium))
                            .accessibilityIdentifier("FillSheetPreviewDocumentButton")

                            Button {
                                isShowingShareFilled = true
                            } label: {
                                Text(shareButtonTitle)
                            }
                            .buttonStyle(.primary(size: .medium))
                            .accessibilityIdentifier("FillSheetShareFilledButton")
                        }
                    } else {
                        Button {
                            isShowingShareFilled = true
                        } label: {
                            Text(shareButtonTitle)
                        }
                        .buttonStyle(.primary(size: .medium))
                        .accessibilityIdentifier("FillSheetShareFilledButton")
                    }
                }
                .padding(14)
            }
        }
    }

    private func actionRow(icon: SharedImageAsset, title: String, subtitle: String? = nil) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .fill(VowkeyMobileTheme.blueSoft)
                    .overlay(
                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                            .strokeBorder(VowkeyMobileTheme.blueSoftBorder, lineWidth: 1),
                    )
                    .frame(width: 34, height: 34)
                icon.swiftUIImage
                    .resizable()
                    .renderingMode(.template)
                    .frame(width: 18, height: 18)
                    .foregroundColor(VowkeyMobileTheme.iconSecondary)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.ink)
                if let subtitle {
                    Text(subtitle)
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer()
            SharedAsset.Icons.chevronRight16.swiftUIImage
                .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }
}

// MARK: - VowkeyFilledFormZoomSheet

private struct VowkeyFilledFormZoomSheet: View {
    let filledImage: UIImage
    let originalImage: UIImage?
    let outputURL: URL?
    let canSaveToPhotos: Bool

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var isShowingOriginal = false
    @SwiftUI.State private var isShowingShare = false
    @SwiftUI.State private var lastPanOffset: CGSize = .zero
    @SwiftUI.State private var lastZoomScale: CGFloat = 1.0
    @SwiftUI.State private var panOffset: CGSize = .zero
    @SwiftUI.State private var zoomScale: CGFloat = 1.0

    private var displayedImage: UIImage {
        if isShowingOriginal, let originalImage {
            return originalImage
        }
        return filledImage
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 12) {
                if originalImage != nil {
                    Picker("Form view", selection: $isShowingOriginal) {
                        Text("Filled").tag(false)
                        Text("Original").tag(true)
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                }

                GeometryReader { proxy in
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(VowkeyMobileTheme.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .strokeBorder(VowkeyMobileTheme.line, lineWidth: 1),
                            )

                        Image(uiImage: displayedImage)
                            .resizable()
                            .scaledToFit()
                            .frame(
                                maxWidth: max(1, proxy.size.width - 16),
                                maxHeight: max(1, proxy.size.height - 16),
                            )
                            .scaleEffect(zoomScale)
                            .offset(panOffset)
                            .gesture(
                                SimultaneousGesture(
                                    MagnificationGesture()
                                        .onChanged { value in
                                            let next = min(max(1.0, lastZoomScale * value), 5.0)
                                            zoomScale = next
                                            if next <= 1.02 {
                                                panOffset = .zero
                                                lastPanOffset = .zero
                                            }
                                        }
                                        .onEnded { _ in
                                            lastZoomScale = zoomScale
                                        },
                                    DragGesture()
                                        .onChanged { drag in
                                            guard zoomScale > 1.02 else { return }
                                            panOffset = CGSize(
                                                width: lastPanOffset.width + drag.translation.width,
                                                height: lastPanOffset.height + drag.translation.height,
                                            )
                                        }
                                        .onEnded { _ in
                                            lastPanOffset = panOffset
                                        },
                                ),
                            )
                            .onTapGesture(count: 2) {
                                withAnimation(.spring(response: 0.26, dampingFraction: 0.84)) {
                                    if zoomScale > 1.2 {
                                        zoomScale = 1.0
                                        lastZoomScale = 1.0
                                        panOffset = .zero
                                        lastPanOffset = .zero
                                    } else {
                                        zoomScale = 2.5
                                        lastZoomScale = 2.5
                                    }
                                }
                            }
                    }
                    .clipped()
                }
                .padding(.horizontal, 12)

                HStack(spacing: 10) {
                    if canSaveToPhotos {
                        VowkeySavePhotoButton(image: filledImage)
                    }

                    if outputURL != nil {
                        Button {
                            isShowingShare = true
                        } label: {
                            Text("Share")
                        }
                        .buttonStyle(.primary(size: .medium))
                    }
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 14)
            }
            .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
            .navigationBar(title: "Filled form", titleDisplayMode: .inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    if zoomScale > 1.05 {
                        Button("Reset zoom") {
                            withAnimation(.easeOut(duration: 0.2)) {
                                zoomScale = 1.0
                                lastZoomScale = 1.0
                                panOffset = .zero
                                lastPanOffset = .zero
                            }
                        }
                        .foregroundColor(VowkeyMobileTheme.blue)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.close) { dismiss() }
                        .foregroundColor(VowkeyMobileTheme.blue)
                }
            }
            .sheet(isPresented: $isShowingShare) {
                if let outputURL {
                    VowkeyShareSheet(items: [outputURL])
                }
            }
        }
    }
}

private struct VowkeySavePhotoButton: View {
    let image: UIImage

    @SwiftUI.State private var isSaving = false
    @SwiftUI.State private var didSave = false
    @SwiftUI.State private var showsError = false

    var body: some View {
        Button {
            Task { @MainActor in
                isSaving = true
                defer { isSaving = false }
                let authorization = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
                guard authorization == .authorized || authorization == .limited else {
                    showsError = true
                    return
                }
                do {
                    try await PHPhotoLibrary.shared().performChanges {
                        PHAssetChangeRequest.creationRequestForAsset(from: image)
                    }
                    didSave = true
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                } catch {
                    showsError = true
                }
            }
        } label: {
            Text(didSave ? "Saved to Photos" : (isSaving ? "Saving…" : "Save to Photos"))
        }
        .buttonStyle(.secondary(size: .medium))
        .disabled(isSaving || didSave)
        .alert("Couldn't save image", isPresented: $showsError) {
            Button(Localizations.ok, role: .cancel) {}
        } message: {
            Text("Check photo access and available storage, or use Share to save the form.")
        }
    }
}

// MARK: - VowkeyQuickLookSheet

private struct VowkeyQuickLookSheet: UIViewControllerRepresentable {
    let url: URL

    func makeCoordinator() -> Coordinator {
        Coordinator(url: url)
    }

    func makeUIViewController(context: Context) -> UINavigationController {
        let preview = QLPreviewController()
        preview.dataSource = context.coordinator
        return UINavigationController(rootViewController: preview)
    }

    func updateUIViewController(_ uiViewController: UINavigationController, context: Context) {
        context.coordinator.url = url
        if let preview = uiViewController.viewControllers.first as? QLPreviewController {
            preview.reloadData()
        }
    }

    final class Coordinator: NSObject, QLPreviewControllerDataSource {
        var url: URL

        init(url: URL) {
            self.url = url
        }

        func numberOfPreviewItems(in _: QLPreviewController) -> Int {
            1
        }

        func previewController(_: QLPreviewController, previewItemAt _: Int) -> QLPreviewItem {
            url as NSURL
        }
    }
}
