import SwiftUI
import UIKit
import UniformTypeIdentifiers
import VowkeyKit
import VowkeyResources
import VowkeySdk

// swiftlint:disable file_length

// MARK: - VowkeyProfileDetailView

struct VowkeyProfileDetailView: View {
    // MARK: Properties

    @ObservedObject var model: VowkeyWorkspaceModel
    let cipherId: String

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var concealedDetailIds = Set<String>()
    @SwiftUI.State private var copiedDetailId: String?
    @SwiftUI.State private var editingDetail: ProfileDetailDraft?
    @SwiftUI.State private var highlightTarget: VowkeyHighlightTarget?
    @SwiftUI.State private var isAddingDetail = false
    @SwiftUI.State private var isRenaming = false
    @SwiftUI.State private var isScanningDocument = false
    @SwiftUI.State private var isShowingDeleteConfirm = false
    @SwiftUI.State private var isShowingFileImporter = false
    @SwiftUI.State private var isShowingFillSheet = false
    @SwiftUI.State private var isShowingPhotoPicker = false
    @SwiftUI.State private var largeTypeTarget: VowkeyLargeTypeTarget?
    @SwiftUI.State private var renameDraft = ""

    private var cipher: CipherView? {
        model.cipher(withId: cipherId)
    }

    private static var captureDocumentTypes: [UTType] {
        var types: [UTType] = [.pdf, .image]
        for ext in ["docx", "xlsx", "hwpx"] {
            if let itemType = UTType(filenameExtension: ext) {
                types.append(itemType)
            }
        }
        return types
    }

    // MARK: Body

    var body: some View {
        Group {
            if let current = cipher {
                profileContent(for: current)
            } else {
                VStack(spacing: 12) {
                    Text("Profile unavailable")
                        .styleGuide(.title2, weight: .semibold)
                        .foregroundColor(VowkeyMobileTheme.ink)
                    Button("Back") {
                        dismiss()
                    }
                    .styleGuide(.bodySemibold, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.blue)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
            }
        }
        .navigationBar(
            title: cipher.map { VowkeyMobileTheme.displayName($0.name) } ?? "Profile",
            titleDisplayMode: .inline,
        )
        .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
        .sheet(isPresented: $isShowingPhotoPicker) {
            VowkeyPhotoLibraryPicker { data in
                Task {
                    _ = await model.captureDocumentFile(
                        data: data,
                        fileName: "photo-document.jpg",
                        mediaType: "image/jpeg",
                        intoProfileId: cipherId,
                    )
                }
            }
        }
        .fileImporter(
            isPresented: $isShowingFileImporter,
            allowedContentTypes: Self.captureDocumentTypes,
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
                    intoProfileId: cipherId,
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
                                intoProfileId: cipherId,
                            )
                        }
                    } else if let pdfData = scan.documentPDF() {
                        Task {
                            _ = await model.captureDocumentFile(
                                data: pdfData,
                                fileName: "scanned-document.pdf",
                                mediaType: "application/pdf",
                                intoProfileId: cipherId,
                            )
                        }
                    }
                },
                onCancel: { isScanningDocument = false },
                onFailure: { _ in isScanningDocument = false },
            )
        }
        .sheet(item: $highlightTarget) { target in
            if let current = cipher {
                VowkeyDocumentHighlightSheet(
                    model: model,
                    cipher: current,
                    initialAttachmentId: target.attachmentId,
                    initialDetailId: target.detailId,
                )
            }
        }
        .sheet(isPresented: $isShowingFillSheet) {
            VowkeyFillFormSheet(model: model, preselectedProfileId: cipherId)
        }
        .sheet(item: $largeTypeTarget) { item in
            VowkeyLargeTypeSheet(label: item.label, value: item.value)
        }
        .sheet(item: $editingDetail) { draft in
            if let current = cipher {
                ProfileDetailEditorSheet(
                    draft: draft,
                    onSave: { label, value, attribute, rule in
                        Task {
                            await model.upsertProfileDetail(
                                cipher: current,
                                detailId: draft.detailId,
                                label: label,
                                value: value,
                                attribute: attribute,
                                agentRule: rule,
                            )
                        }
                    },
                    onDelete: draft.detailId == nil ? nil : {
                        if let detailId = draft.detailId {
                            Task { await model.deleteProfileDetail(cipher: current, detailId: detailId) }
                        }
                    },
                )
            }
        }
        .sheet(isPresented: $isAddingDetail) {
            if let current = cipher {
                ProfileDetailEditorSheet(
                    draft: ProfileDetailDraft(
                        detailId: nil,
                        label: "",
                        value: "",
                        attribute: nil,
                        agentRule: "fill",
                    ),
                    onSave: { label, value, attribute, rule in
                        Task {
                            await model.upsertProfileDetail(
                                cipher: current,
                                detailId: nil,
                                label: label,
                                value: value,
                                attribute: attribute,
                                agentRule: rule,
                            )
                        }
                    },
                    onDelete: nil,
                )
            }
        }
        .alert("Rename profile", isPresented: $isRenaming) {
            TextField("Name", text: $renameDraft)
            Button("Save") {
                if let current = cipher {
                    Task { await model.renameProfile(current, newName: renameDraft) }
                }
            }
            Button(Localizations.cancel, role: .cancel) {}
        }
        .confirmationDialog(
            "Move this profile to recently deleted?",
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
    }

    // MARK: Private Views

    @ViewBuilder
    private func profileContent(for current: CipherView) -> some View {
        let details = NativeProfile.details(current)
        let sources = NativeProfile.sources(current)
        let grouped = Self.groupDetails(details)

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                headerCard(
                    for: current,
                    detailsCount: details.count,
                    sourcesCount: sources.count,
                )

                ForEach(Array(grouped.enumerated()), id: \.element.id) { groupIndex, section in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            VowkeySectionHeader(section.title)
                            Spacer()
                            if groupIndex == 0 {
                                Button {
                                    isAddingDetail = true
                                } label: {
                                    Text("Add detail")
                                        .styleGuide(.subheadlineSemibold, includeLinePadding: false, includeLineSpacing: false)
                                        .foregroundColor(VowkeyMobileTheme.blue)
                                }
                                .buttonStyle(.plain)
                                .padding(.trailing, 4)
                            }
                        }

                        VowkeyGroupedCard {
                            ForEach(Array(section.rows.enumerated()), id: \.offset) { index, detail in
                                detailRow(detail, cipher: current, sources: sources)
                                if index < section.rows.count - 1 {
                                    Divider().padding(.leading, 16)
                                }
                            }
                        }
                    }
                }

                if grouped.isEmpty {
                    Button {
                        isAddingDetail = true
                    } label: {
                        Text("Add detail")
                    }
                    .buttonStyle(.secondary(size: .medium))
                }

                sourcesSection(for: current, sources: sources)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 88)
        }
        .background(VowkeyMobileTheme.canvas)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button {
                        renameDraft = VowkeyMobileTheme.displayName(current.name)
                        isRenaming = true
                    } label: {
                        Label("Rename profile", systemImage: "pencil")
                    }

                    Button {
                        isAddingDetail = true
                    } label: {
                        Label("Add detail", systemImage: "plus")
                    }

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
                .accessibilityIdentifier("ProfileMoreMenuButton")
            }
        }
    }

    private func headerCard(
        for current: CipherView,
        detailsCount: Int,
        sourcesCount: Int,
    ) -> some View {
        VowkeyGroupedCard {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 14) {
                    VowkeyMonogramTile(
                        name: current.name,
                        seed: current.id ?? current.name,
                        size: 50,
                        highlighted: true,
                    )

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(spacing: 6) {
                            Text(VowkeyMobileTheme.displayName(current.name))
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

                        HStack(spacing: 6) {
                            Text("\(detailsCount) detail\(detailsCount == 1 ? "" : "s") · \(sourcesCount) document\(sourcesCount == 1 ? "" : "s")")
                                .styleGuide(.callout, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                            if VowkeyWorkspaceModel.isSampleCipher(current) {
                                VowkeySampleTag()
                            }
                        }
                    }
                    Spacer(minLength: 0)
                }

                HStack(spacing: 10) {
                    Button {
                        model.selectedProfileId = cipherId
                        isShowingFillSheet = true
                    } label: {
                        Text(VowkeyMobileTheme.tr("VowkeyFillForm", "Fill form"))
                    }
                    .buttonStyle(.primary(size: .medium))
                    .accessibilityIdentifier("ProfileFillFormButton")

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
                            Label("Choose PDF or document", systemImage: "folder")
                        }
                    } label: {
                        VowkeySecondaryActionLabel(
                            title: "Add document",
                            icon: SharedAsset.Icons.fileUpload24,
                        )
                    }
                    .accessibilityIdentifier("ProfileAddDocumentMenu")
                }
            }
            .padding(16)
        }
    }

    private func detailRow(
        _ detail: [String: Any],
        cipher: CipherView,
        sources: [[String: Any]],
    ) -> some View {
        let detailId = (detail["id"] as? String) ?? UUID().uuidString.lowercased()
        let label = (detail["label"] as? String) ?? "Detail"
        let attribute = detail["attribute"] as? String
        let activeValue = NativeProfile.value(detail) ?? ""
        let variants = NativeProfile.variants(detail)
        let rule = (detail["agentRule"] as? String) ?? "fill"
        let isSensitive = Self.isSensitiveAttribute(attribute)
        let isRevealed = !isSensitive || !concealedDetailIds.contains(detailId)
        let hasLocator = NativeProfile.locator(for: detail) != nil
        let attachmentId = Self.resolveAttachmentId(
            for: detail,
            hasLocator: hasLocator,
            sources: sources,
            cipher: cipher,
        )
        let chipShape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        let badgeShape = RoundedRectangle(cornerRadius: 6, style: .continuous)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 8) {
                Button {
                    UIPasteboard.general.string = activeValue
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    copiedDetailId = detailId
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        if copiedDetailId == detailId {
                            copiedDetailId = nil
                        }
                    }
                } label: {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(label)
                                .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                            if rule == "never" {
                                Text("Don't fill")
                                    .styleGuide(.caption2, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.red)
                                    .padding(.horizontal, 6)
                                    .padding(.vertical, 2)
                                    .background(badgeShape.fill(VowkeyMobileTheme.redSoft))
                                    .overlay(badgeShape.strokeBorder(VowkeyMobileTheme.redBorder, lineWidth: 1))
                            }
                            if copiedDetailId == detailId {
                                Text(VowkeyMobileTheme.copiedText)
                                    .styleGuide(.caption2, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                    .foregroundColor(VowkeyMobileTheme.green)
                            }
                        }

                        if isSensitive {
                            Text(isRevealed ? activeValue : Self.maskedValue(activeValue))
                                .styleGuide(.sensitiveInfoSmall, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                                .multilineTextAlignment(.leading)
                                .lineLimit(2)
                        } else {
                            Text(activeValue)
                                .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                                .multilineTextAlignment(.leading)
                                .lineLimit(2)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)

                if isSensitive {
                    Button {
                        if concealedDetailIds.contains(detailId) {
                            concealedDetailIds.remove(detailId)
                        } else {
                            concealedDetailIds.insert(detailId)
                        }
                    } label: {
                        (isRevealed ? SharedAsset.Icons.eyeSlash24 : SharedAsset.Icons.eye24)
                            .swiftUIImage
                            .resizable()
                            .renderingMode(.template)
                            .frame(width: 18, height: 18)
                            .foregroundColor(VowkeyMobileTheme.muted)
                            .frame(width: 30, height: 30)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(isRevealed ? "Hide value" : "Show value")
                }

                if let attachmentId {
                    Button {
                        highlightTarget = VowkeyHighlightTarget(
                            id: "\(attachmentId):\(detailId)",
                            attachmentId: attachmentId,
                            detailId: detailId,
                        )
                    } label: {
                        Image(systemName: hasLocator ? "doc.viewfinder" : "doc.text.magnifyingglass")
                            .font(.footnote.weight(.semibold))
                            .foregroundColor(VowkeyMobileTheme.blueInk)
                            .frame(width: 30, height: 30)
                            .background(
                                chipShape
                                    .fill(VowkeyMobileTheme.blueSoft)
                                    .overlay(
                                        chipShape
                                            .strokeBorder(VowkeyMobileTheme.blueSoftBorder, lineWidth: 1),
                                    ),
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Show in document")
                    .accessibilityIdentifier("ShowInDocument_\(detailId)")
                }

                Menu {
                    Button {
                        editingDetail = ProfileDetailDraft(
                            detailId: detailId,
                            label: label,
                            value: activeValue,
                            attribute: attribute,
                            agentRule: rule,
                        )
                    } label: {
                        Label("Edit", systemImage: "pencil")
                    }

                    Button {
                        largeTypeTarget = VowkeyLargeTypeTarget(label: label, value: activeValue)
                    } label: {
                        Label("Large type", systemImage: "textformat.size.larger")
                    }

                    Section("AI access") {
                        ForEach(["fill", "ask", "never"], id: \.self) { option in
                            Button {
                                Task {
                                    await model.setProfileDetailAgentRule(
                                        cipher: cipher,
                                        detailId: detailId,
                                        rule: option,
                                    )
                                }
                            } label: {
                                Label(
                                    NativeProfile.humanAgentRuleLabel(option),
                                    systemImage: rule == option ? "checkmark" : Self.agentRuleIcon(option),
                                )
                            }
                        }
                    }

                    Section {
                        Button(role: .destructive) {
                            Task { await model.deleteProfileDetail(cipher: cipher, detailId: detailId) }
                        } label: {
                            Label("Delete detail", systemImage: "trash")
                        }
                    }
                } label: {
                    SharedAsset.Icons.ellipsisHorizontal24.swiftUIImage
                        .resizable()
                        .renderingMode(.template)
                        .frame(width: 18, height: 18)
                        .foregroundColor(VowkeyMobileTheme.muted)
                        .frame(width: 30, height: 30)
                }
                .accessibilityLabel("More options for \(label)")
                .accessibilityIdentifier("DetailRuleMenu_\(detailId)")
            }

            if variants.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(Array(variants.enumerated()), id: \.offset) { _, variant in
                            let candidate = (variant["value"] as? String) ?? ""
                            let badge = NativeProfile.humanVariantBadge(
                                script: variant["script"] as? String,
                                tag: variant["tag"] as? String,
                            )
                            let isChosen = candidate == activeValue
                            Button {
                                Task {
                                    await model.selectDetailVariant(
                                        cipher: cipher,
                                        detailId: detailId,
                                        value: candidate,
                                    )
                                }
                            } label: {
                                HStack(spacing: 4) {
                                    if let badge, !badge.isEmpty {
                                        Text(badge)
                                            .styleGuide(.caption2, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                                            .foregroundColor(isChosen ? VowkeyMobileTheme.blueInk : VowkeyMobileTheme.muted)
                                    }
                                    Text(candidate)
                                        .styleGuide(.subheadline, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                        .foregroundColor(isChosen ? VowkeyMobileTheme.blueInk : VowkeyMobileTheme.muted)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 5)
                                .background(
                                    chipShape.fill(isChosen ? VowkeyMobileTheme.blueSoft : VowkeyMobileTheme.chipFill),
                                )
                                .overlay(
                                    chipShape.strokeBorder(
                                        isChosen ? VowkeyMobileTheme.blueSoftBorder : VowkeyMobileTheme.line,
                                        lineWidth: 1,
                                    ),
                                )
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func sourcesSection(for current: CipherView, sources: [[String: Any]]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VowkeySectionHeader(VowkeyMobileTheme.tr("VowkeyDocuments", "Documents"))

            if sources.isEmpty {
                VowkeyGroupedCard {
                    HStack(spacing: 12) {
                        VowkeyKindTile(kind: .document, size: 38)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("No source documents attached")
                                .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.ink)
                            Text("Scan or import an ID, passport, or form to link fields to their source page.")
                                .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                                .foregroundColor(VowkeyMobileTheme.muted)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(14)
                }
            } else {
                VowkeyGroupedCard {
                    ForEach(Array(sources.enumerated()), id: \.offset) { index, source in
                        let sourceId = (source["id"] as? String) ?? ""
                        let attachmentId = NativeProfile.resolvedAttachmentKey(for: source, cipher: current)
                        let fileName = (source["fileName"] as? String) ?? ""
                        let kindTitle = NativeProfile.humanDocumentTitle(for: source, fallbackName: fileName)
                        let expiresOn = source["expiresOn"] as? String
                        let matchedEntry = model.documents.first {
                            $0.cipherId == (current.id ?? "") && ($0.sourceId == sourceId || $0.attachmentId == attachmentId)
                        }

                        if let matchedEntry {
                            NavigationLink {
                                VowkeyDocumentDetailView(model: model, entry: matchedEntry)
                            } label: {
                                sourceRowContent(
                                    cipherId: current.id ?? "",
                                    attachmentId: attachmentId,
                                    kindTitle: kindTitle,
                                    subtitle: expiresOn.map { "Valid until \($0)" } ?? fileName,
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("ProfileSourceRow_\(index)")
                        } else {
                            Button {
                                guard !attachmentId.isEmpty else { return }
                                highlightTarget = VowkeyHighlightTarget(
                                    id: "\(attachmentId):first",
                                    attachmentId: attachmentId,
                                    detailId: nil,
                                )
                            } label: {
                                sourceRowContent(
                                    cipherId: current.id ?? "",
                                    attachmentId: attachmentId,
                                    kindTitle: kindTitle,
                                    subtitle: expiresOn.map { "Valid until \($0)" } ?? fileName,
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("ProfileSourceRow_\(index)")
                        }

                        if index < sources.count - 1 {
                            Divider().padding(.leading, 78)
                        }
                    }
                }
            }
        }
    }

    private func sourceRowContent(
        cipherId: String,
        attachmentId: String,
        kindTitle: String,
        subtitle: String,
    ) -> some View {
        HStack(spacing: 12) {
            VowkeySourceThumbnailView(
                model: model,
                cipherId: cipherId,
                attachmentId: attachmentId,
                size: CGSize(width: 52, height: 36),
            )

            VStack(alignment: .leading, spacing: 2) {
                Text(kindTitle)
                    .styleGuide(.body, weight: .medium, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.ink)
                    .lineLimit(1)
                Text(subtitle)
                    .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                    .foregroundColor(VowkeyMobileTheme.muted)
                    .lineLimit(1)
            }

            Spacer()

            SharedAsset.Icons.chevronRight16.swiftUIImage
                .imageStyle(.accessoryIcon16(color: VowkeyMobileTheme.muted))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .contentShape(Rectangle())
    }

    // MARK: Static Grouping Helpers

    private static func groupDetails(_ details: [[String: Any]]) -> [DetailDomainGroup] {
        var buckets: [String: [[String: Any]]] = [:]
        let order = [
            "Personal details",
            "Birth & nationality",
            "Documents & IDs",
            "Contact & address",
            "Work & finance",
            "Additional details",
        ]
        for detail in details {
            let attr = ((detail["attribute"] as? String) ?? "").lowercased()
            let bucket = if attr.hasPrefix("name.") || attr == "person.sex" || attr == "person.gender" {
                "Personal details"
            } else if attr.hasPrefix("birth.") || attr.contains("nationality") || attr.contains("citizenship") {
                "Birth & nationality"
            } else if attr.hasPrefix("id.") || attr.hasPrefix("visa.") {
                "Documents & IDs"
            } else if attr.hasPrefix("address.") || attr.hasPrefix("contact.") {
                "Contact & address"
            } else if attr.hasPrefix("work.") || attr.hasPrefix("bank.") || attr.hasPrefix("tax.") || attr.hasPrefix("income.") {
                "Work & finance"
            } else {
                "Additional details"
            }
            buckets[bucket, default: []].append(detail)
        }
        return order.compactMap { title in
            guard let rows = buckets[title], !rows.isEmpty else { return nil }
            return DetailDomainGroup(id: title, title: title, rows: rows)
        }
    }

    private static func isSensitiveAttribute(_ attribute: String?) -> Bool {
        guard let attr = attribute?.lowercased() else { return false }
        if attr.hasSuffix(".expiry") || attr.hasSuffix(".issued") || attr.hasSuffix(".status") {
            return false
        }
        return attr.contains(".number")
            || attr.contains("ssn")
            || attr.contains("tax.id")
            || attr.contains("iban")
            || attr.contains("account")
    }

    private static func maskedValue(_ raw: String) -> String {
        guard raw.count > 4 else { return "••••" }
        return "•••• " + String(raw.suffix(4))
    }

    private static func agentRuleIcon(_ rule: String) -> String {
        switch rule {
        case "never":
            "lock.shield"
        case "ask":
            "hand.raised"
        default:
            "checkmark.shield"
        }
    }

    private static func resolveAttachmentId(
        for detail: [String: Any],
        hasLocator: Bool,
        sources: [[String: Any]],
        cipher: CipherView,
    ) -> String? {
        if let sourceId = NativeProfile.sourceId(for: detail),
           let matched = sources.first(where: { ($0["id"] as? String) == sourceId }) {
            let resolved = NativeProfile.resolvedAttachmentKey(for: matched, cipher: cipher)
            if !resolved.isEmpty {
                return resolved
            }
        }
        guard hasLocator, let firstSource = sources.first else {
            return nil
        }
        let resolved = NativeProfile.resolvedAttachmentKey(for: firstSource, cipher: cipher)
        return resolved.isEmpty ? nil : resolved
    }
}

// MARK: - Supporting Types

private struct VowkeyLargeTypeTarget: Identifiable {
    let id = UUID()
    let label: String
    let value: String
}

private struct VowkeyLargeTypeSheet: View {
    let label: String
    let value: String
    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var copied = false

    var body: some View {
        NavigationView {
            VStack(alignment: .leading, spacing: 18) {
                Text(label)
                    .styleGuide(.subheadlineSemibold, weight: .semibold, includeLinePadding: false)
                    .foregroundColor(VowkeyMobileTheme.muted)

                VowkeyGroupedCard {
                    Text(value)
                        .font(.system(size: 30, weight: .semibold, design: .monospaced))
                        .foregroundColor(VowkeyMobileTheme.ink)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(20)
                }

                Button(copied ? VowkeyMobileTheme.copiedText : Localizations.copy) {
                    UIPasteboard.general.string = value
                    copied = true
                }
                .buttonStyle(.primary(size: .medium))

                Spacer()
            }
            .padding(16)
            .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
            .navigationBar(title: "Large type", titleDisplayMode: .inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.close) { dismiss() }
                        .foregroundColor(VowkeyMobileTheme.blue)
                }
            }
        }
    }
}

private struct DetailDomainGroup: Identifiable {
    let id: String
    let title: String
    let rows: [[String: Any]]
}

struct VowkeyHighlightTarget: Identifiable {
    let id: String
    let attachmentId: String
    let detailId: String?
}

private struct ProfileDetailDraft: Identifiable {
    let detailId: String?
    let label: String
    let value: String
    let attribute: String?
    let agentRule: String

    var id: String { detailId ?? "new" }
}

// MARK: - ProfileDetailEditorSheet

private struct ProfileDetailEditorSheet: View {
    let draft: ProfileDetailDraft
    let onSave: (String, String, String?, String) -> Void
    let onDelete: (() -> Void)?

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var agentRule: String
    @SwiftUI.State private var label: String
    @SwiftUI.State private var value: String

    init(
        draft: ProfileDetailDraft,
        onSave: @escaping (String, String, String?, String) -> Void,
        onDelete: (() -> Void)?,
    ) {
        self.draft = draft
        self.onSave = onSave
        self.onDelete = onDelete
        _label = SwiftUI.State(initialValue: draft.label)
        _value = SwiftUI.State(initialValue: draft.value)
        _agentRule = SwiftUI.State(initialValue: draft.agentRule)
    }

    var body: some View {
        NavigationView {
            Form {
                Section("Detail") {
                    TextField("Label (e.g. Passport number, Employer)", text: $label)
                        .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                    TextField("Value", text: $value)
                        .styleGuide(.body, includeLinePadding: false, includeLineSpacing: false)
                }

                Section("When AI agents ask for this detail") {
                    Picker("AI agent rule", selection: $agentRule) {
                        Text("Fill without asking").tag("fill")
                        Text("Ask first").tag("ask")
                        Text("Don't fill").tag("never")
                    }
                    .pickerStyle(.inline)
                }

                if let onDelete {
                    Section {
                        Button("Delete detail", role: .destructive) {
                            onDelete()
                            dismiss()
                        }
                    }
                }
            }
            .navigationBar(title: draft.detailId == nil ? "Add detail" : "Edit detail", titleDisplayMode: .inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(Localizations.cancel) { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.save) {
                        onSave(label, value, draft.attribute, agentRule)
                        dismiss()
                    }
                    .disabled(
                        label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                            || value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    )
                }
            }
        }
    }
}

// MARK: - VowkeySourceThumbnailView

struct VowkeySourceThumbnailView: View {
    @ObservedObject var model: VowkeyWorkspaceModel
    let cipherId: String
    let attachmentId: String
    var size = CGSize(width: 52, height: 36)

    @SwiftUI.State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(VowkeyMobileTheme.elevated)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
                    .frame(width: size.width, height: size.height)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            } else {
                SharedAsset.Icons.fileText24.swiftUIImage
                    .resizable()
                    .renderingMode(.template)
                    .frame(width: 18, height: 18)
                    .foregroundColor(VowkeyMobileTheme.iconSecondary)
            }
        }
        .frame(width: size.width, height: size.height)
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(VowkeyMobileTheme.line, lineWidth: 1),
        )
        .task(id: "\(cipherId):\(attachmentId)") {
            guard !attachmentId.isEmpty else { return }
            image = await model.loadSourcePageImage(
                cipherId: cipherId,
                attachmentId: attachmentId,
                pageIndex: 0,
                maxDimension: 360,
            )
        }
    }
}

// MARK: - VowkeyDocumentHighlightSheet

struct VowkeyDocumentHighlightSheet: View {
    @ObservedObject var model: VowkeyWorkspaceModel
    let cipher: CipherView
    let initialAttachmentId: String
    let initialDetailId: String?

    @SwiftUI.Environment(\.dismiss) private var dismiss
    @SwiftUI.State private var copied = false
    @SwiftUI.State private var didFinishLoadingImage = false
    @SwiftUI.State private var lastPanOffset: CGSize = .zero
    @SwiftUI.State private var lastZoomScale: CGFloat = 1.0
    @SwiftUI.State private var pageImage: UIImage?
    @SwiftUI.State private var panOffset: CGSize = .zero
    @SwiftUI.State private var selectedDetailId: String?
    @SwiftUI.State private var zoomScale: CGFloat = 1.0

    private var matchingSource: [String: Any]? {
        NativeProfile.sources(cipher).first {
            NativeProfile.resolvedAttachmentKey(for: $0, cipher: cipher) == initialAttachmentId
                || ($0["id"] as? String) == initialAttachmentId
        }
    }

    private var sourceDetails: [[String: Any]] {
        let sourceId = matchingSource?["id"] as? String
        let allDetails = NativeProfile.details(cipher)
        let filtered = allDetails.filter { row in
            if let sourceId, let rowSource = NativeProfile.sourceId(for: row) {
                return rowSource == sourceId
            }
            return true
        }
        return filtered.isEmpty ? allDetails : filtered
    }

    private var activeDetail: [String: Any]? {
        if let selectedDetailId,
           let match = sourceDetails.first(where: { ($0["id"] as? String) == selectedDetailId }) {
            return match
        }
        return sourceDetails.first { NativeProfile.locator(for: $0) != nil } ?? sourceDetails.first
    }

    private var activePageIndex: Int {
        guard let activeDetail, let loc = NativeProfile.locator(for: activeDetail) else { return 0 }
        return (loc["page"] as? Int) ?? 0
    }

    var body: some View {
        NavigationView {
            VStack(spacing: 14) {
                documentCanvas
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                if let activeDetail {
                    selectedFieldBar(for: activeDetail)
                        .padding(.horizontal, 16)
                }

                detailChipsStrip
                    .padding(.bottom, 12)
            }
            .background(VowkeyMobileTheme.canvas.ignoresSafeArea())
            .navigationBar(
                title: matchingSource.map {
                    NativeProfile.humanDocumentTitle(
                        for: $0,
                        fallbackName: ($0["fileName"] as? String) ?? "",
                    )
                } ?? VowkeyMobileTheme.tr("VowkeyShowInDocument", "Show in document"),
                titleDisplayMode: .inline,
            )
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
                        .styleGuide(.calloutSemibold, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.blue)
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(Localizations.close) {
                        dismiss()
                    }
                    .foregroundColor(VowkeyMobileTheme.blue)
                }
            }
            .task(id: "\(initialAttachmentId):\(activePageIndex)") {
                didFinishLoadingImage = false
                if selectedDetailId == nil {
                    selectedDetailId = initialDetailId ?? (activeDetail?["id"] as? String)
                }
                pageImage = await model.loadSourcePageImage(
                    cipherId: cipher.id ?? "",
                    attachmentId: initialAttachmentId,
                    pageIndex: activePageIndex,
                    maxDimension: 1600,
                )
                didFinishLoadingImage = true
            }
        }
    }

    private var documentCanvas: some View {
        GeometryReader { proxy in
            ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(VowkeyMobileTheme.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .strokeBorder(VowkeyMobileTheme.line, lineWidth: 1),
                    )

                if let pageImage {
                    let fitted = Self.aspectFitRect(imageSize: pageImage.size, in: proxy.size.insetBy(dx: 12, dy: 12))
                    ZStack(alignment: .topLeading) {
                        Image(uiImage: pageImage)
                            .resizable()
                            .frame(width: fitted.width, height: fitted.height)
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))

                        if let activeDetail,
                           let locator = NativeProfile.locator(for: activeDetail),
                           let normX = Self.doubleValue(locator["x"]),
                           let normY = Self.doubleValue(locator["y"]),
                           let normW = Self.doubleValue(locator["w"]),
                           let normH = Self.doubleValue(locator["h"]) {
                            let pad: CGFloat = 4
                            let boxWidth = max(24, CGFloat(normW) * fitted.width + pad * 2)
                            let boxHeight = max(18, CGFloat(normH) * fitted.height + pad * 2)
                            let boxOriginX = CGFloat(normX) * fitted.width - pad
                            let boxOriginY = CGFloat(normY) * fitted.height - pad

                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(VowkeyMobileTheme.blue.opacity(0.16))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .stroke(VowkeyMobileTheme.blue, lineWidth: 2.5),
                                )
                                .frame(width: boxWidth, height: boxHeight)
                                .offset(x: boxOriginX, y: boxOriginY)
                                .animation(.spring(response: 0.28, dampingFraction: 0.82), value: selectedDetailId)
                        }
                    }
                    .scaleEffect(zoomScale)
                    .offset(panOffset)
                    .gesture(
                        SimultaneousGesture(
                            MagnificationGesture()
                                .onChanged { value in
                                    let next = min(max(1.0, lastZoomScale * value), 4.0)
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
                                zoomScale = 2.4
                                lastZoomScale = 2.4
                            }
                        }
                    }
                } else if didFinishLoadingImage {
                    VStack(spacing: 8) {
                        VowkeyKindTile(kind: .document, size: 48)
                        Text("Original image not stored on this item")
                            .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                            .foregroundColor(VowkeyMobileTheme.muted)
                    }
                } else {
                    ProgressView()
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func selectedFieldBar(for detail: [String: Any]) -> some View {
        let label = (detail["label"] as? String) ?? "Detail"
        let value = NativeProfile.value(detail) ?? ""
        return VowkeyGroupedCard {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(label)
                        .styleGuide(.subheadline, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.muted)
                    Text(value)
                        .styleGuide(.body, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                        .foregroundColor(VowkeyMobileTheme.ink)
                        .lineLimit(2)
                }
                Spacer()
                Button {
                    UIPasteboard.general.string = value
                    copied = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_300_000_000)
                        copied = false
                    }
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
                    .padding(.vertical, 7)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(VowkeyMobileTheme.blueSoft),
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .strokeBorder(VowkeyMobileTheme.blueSoftBorder, lineWidth: 1),
                    )
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
        }
    }

    private var detailChipsStrip: some View {
        let chipShape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Array(sourceDetails.enumerated()), id: \.offset) { _, detail in
                    let detailId = (detail["id"] as? String) ?? ""
                    let label = (detail["label"] as? String) ?? "Field"
                    let isSelected = detailId == (activeDetail?["id"] as? String)
                    let hasBox = NativeProfile.locator(for: detail) != nil
                    Button {
                        selectedDetailId = detailId
                    } label: {
                        HStack(spacing: 5) {
                            if hasBox {
                                Image(systemName: "viewfinder")
                                    .font(.caption2.weight(.semibold))
                            }
                            Text(label)
                                .styleGuide(.callout, weight: .semibold, includeLinePadding: false, includeLineSpacing: false)
                        }
                        .foregroundColor(isSelected ? SharedAsset.Colors.buttonFilledForeground.swiftUIColor : VowkeyMobileTheme.ink)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            chipShape.fill(
                                isSelected ? SharedAsset.Colors.buttonFilledBackground.swiftUIColor : VowkeyMobileTheme.surface,
                            ),
                        )
                        .overlay(
                            chipShape
                                .strokeBorder(isSelected ? Color.clear : VowkeyMobileTheme.line, lineWidth: 1),
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("HighlightChip_\(label)")
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private static func aspectFitRect(imageSize: CGSize, in containerSize: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0, containerSize.width > 0, containerSize.height > 0 else {
            return .zero
        }
        let scale = min(containerSize.width / imageSize.width, containerSize.height / imageSize.height)
        let width = imageSize.width * scale
        let height = imageSize.height * scale
        return CGRect(x: 0, y: 0, width: width, height: height)
    }

    private static func doubleValue(_ any: Any?) -> Double? {
        if let value = any as? Double { return value }
        if let number = any as? NSNumber { return number.doubleValue }
        return nil
    }
}

private extension CGSize {
    func insetBy(dx: CGFloat, dy: CGFloat) -> CGSize {
        CGSize(width: max(1, width - dx * 2), height: max(1, height - dy * 2))
    }
}
