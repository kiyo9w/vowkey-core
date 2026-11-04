import Foundation
import ImageIO
import PDFKit
import UIKit
import Vision
import VowkeySdk

/// Reads documents (text, photos, scans, and PDFs) and matches unseen form fields through Decision
/// and Vowkey's local standard/heuristic engine when offline.
enum NativeDecision {
    typealias Account = (CipherService, ClientService, StateService, APIService)

    struct RecognizedPiece: Sendable {
        let text: String
        let x: Double
        let y: Double
        let w: Double
        let h: Double
        let confidence: Double

        var jsonObject: [String: Any] {
            [
                "text": text,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
                "confidence": confidence,
            ]
        }
    }

    struct RecognizedPage: Sendable {
        let index: Int
        let aspect: Double
        let pieces: [RecognizedPiece]

        var jsonObject: [String: Any] {
            [
                "index": index,
                "aspect": aspect,
                "pieces": pieces.map(\.jsonObject),
            ]
        }
    }

    static func read(
        text: String,
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [String: Any] {
        let pieces = text
            .split(separator: "\n")
            .map { String($0).trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
            .enumerated()
            .map { idx, line in
                RecognizedPiece(
                    text: line,
                    x: 0.05,
                    y: min(0.95, Double(idx) * 0.04),
                    w: 0.9,
                    h: 0.03,
                    confidence: 1.0,
                )
            }
        guard !pieces.isEmpty else { throw NativeVaultError.unreadable }
        return try await readPages(
            [RecognizedPage(index: 0, aspect: 1.0, pieces: pieces)],
            extraText: text,
            account: account,
            userId: userId,
            installationId: installationId,
        )
    }

    static func readFile(
        data: Data,
        fileName: String,
        mediaType: String,
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [String: Any] {
        let lower = fileName.lowercased()
        let isPDF = mediaType == "application/pdf" || lower.hasSuffix(".pdf")
        let recognized: (pages: [RecognizedPage], extraText: String) = if isPDF {
            try recognizePDF(data)
        } else {
            try recognizeImage(data)
        }
        guard !recognized.pages.flatMap(\.pieces).isEmpty || !recognized.extraText.isEmpty else {
            throw NativeVaultError.unreadable
        }
        return try await readPages(
            recognized.pages,
            extraText: recognized.extraText,
            account: account,
            userId: userId,
            installationId: installationId,
        )
    }

    static func recognizeImage(_ data: Data) throws -> (pages: [RecognizedPage], extraText: String) {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            throw NativeVaultError.unreadable
        }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let rawOrientation = (properties?[kCGImagePropertyOrientation] as? UInt32) ?? 1
        let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
        let width = max(1, cgImage.width)
        let height = max(1, cgImage.height)
        if min(width, height) < 120 {
            throw NativeVaultError.unreadable
        }
        let (pieces, barcodes) = try runVision(on: cgImage, orientation: orientation)
        let aspect = Double(width) / Double(height)
        return (
            pages: [RecognizedPage(index: 0, aspect: aspect, pieces: pieces)],
            extraText: barcodes.joined(separator: "\n"),
        )
    }

    static func recognizePDF(_ data: Data) throws -> (pages: [RecognizedPage], extraText: String) {
        guard let pdf = PDFDocument(data: data), pdf.pageCount > 0 else {
            throw NativeVaultError.unreadable
        }
        var pages: [RecognizedPage] = []
        var extraChunks: [String] = []
        let count = min(pdf.pageCount, 8)
        for index in 0..<count {
            guard let page = pdf.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let aspect = bounds.height > 0 ? Double(bounds.width / bounds.height) : 0.707
            if let pageString = page.string?.trimmingCharacters(in: .whitespacesAndNewlines),
               !pageString.isEmpty {
                extraChunks.append(pageString)
            }
            let thumb = page.thumbnail(of: CGSize(width: 1600, height: 2200), for: .mediaBox)
            if let cgImage = thumb.cgImage {
                let (pieces, barcodes) = try runVision(on: cgImage, orientation: .up)
                pages.append(RecognizedPage(index: index, aspect: aspect, pieces: pieces))
                extraChunks.append(contentsOf: barcodes)
            }
        }
        return (pages: pages, extraText: extraChunks.joined(separator: "\n"))
    }

    private static func runVision(
        on cgImage: CGImage,
        orientation: CGImagePropertyOrientation,
    ) throws -> ([RecognizedPiece], [String]) {
        let textRequest = VNRecognizeTextRequest()
        textRequest.recognitionLevel = .accurate
        textRequest.usesLanguageCorrection = true
        if #available(iOS 16.0, *) {
            textRequest.automaticallyDetectsLanguage = true
        }
        let barcodeRequest = VNDetectBarcodesRequest()
        barcodeRequest.symbologies = [.qr, .pdf417, .aztec, .dataMatrix]
        #if targetEnvironment(simulator)
        // The simulator has no Neural Engine; Vision reads text there only on the CPU.
        if #available(iOS 17.0, *) {
            for request in [textRequest as VNRequest, barcodeRequest] {
                for stage in (try? request.supportedComputeStageDevices) ?? [:] {
                    if let cpu = stage.value.first(where: { "\($0)".contains("CPU") }) {
                        request.setComputeDevice(cpu, for: stage.key)
                    }
                }
            }
        }
        #endif

        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        try handler.perform([textRequest, barcodeRequest])

        let pieces: [RecognizedPiece] = (textRequest.results ?? []).compactMap { observation in
            guard let top = observation.topCandidates(1).first else { return nil }
            let text = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let box = observation.boundingBox
            return RecognizedPiece(
                text: text,
                x: Double(max(0, min(1, box.minX))),
                y: Double(max(0, min(1, 1.0 - box.maxY))),
                w: Double(max(0, min(1, box.width))),
                h: Double(max(0, min(1, box.height))),
                confidence: Double(top.confidence),
            )
        }
        let barcodes: [String] = (barcodeRequest.results ?? []).compactMap { obs in
            obs.payloadStringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
        }.filter { !$0.isEmpty }

        return (pieces, barcodes)
    }

    private static func readPages(
        _ pages: [RecognizedPage],
        extraText: String,
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [String: Any] {
        let year = UInt16(Calendar.current.component(.year, from: Date()))
        let ocrLines = pages.flatMap(\.pieces).map(\.text)
        let fullText = (ocrLines + (extraText.isEmpty ? [] : [extraText])).joined(separator: "\n")

        let readingData = try JSONSerialization.data(withJSONObject: ["pages": pages.map(\.jsonObject)])
        guard let readingJson = String(data: readingData, encoding: .utf8) else {
            throw NativeVaultError.unreadable
        }

        do {
            var plan = try captureDecisionBegin(readingJson: readingJson, perRequest: 0)
            let firstAnswers = try await answerRequests(
                captureDecisionRequests(planJson: plan, secondRound: false),
                account: account,
                userId: userId,
                installationId: installationId,
            )
            plan = try captureDecisionTakeFirstAnswers(planJson: plan, responsesJson: firstAnswers)
            let secondAnswers = try await answerRequests(
                captureDecisionRequests(planJson: plan, secondRound: true),
                account: account,
                userId: userId,
                installationId: installationId,
            )
            let finishedJson = try captureDecisionFinish(
                planJson: plan,
                responsesJson: secondAnswers,
                extraText: fullText,
                currentYear: year,
            )
            if let parsed = parseCapturedDocument(finishedJson) {
                return parsed
            }
        } catch {
            if let local = try? localStandardFallback(fullText: fullText, year: year) {
                return local
            }
            throw error
        }

        if let local = try? localStandardFallback(fullText: fullText, year: year) {
            return local
        }
        throw NativeVaultError.unreadable
    }

    private static func localStandardFallback(fullText: String, year: UInt16) throws -> [String: Any]? {
        guard !fullText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        let fallbackJson = try captureDocumentText(text: fullText, currentYear: year)
        return parseCapturedDocument(fallbackJson)
    }

    private static func parseCapturedDocument(_ json: String) -> [String: Any]? {
        guard let data = json.data(using: .utf8),
              let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let details = parsed["details"] as? [String: String],
              !details.isEmpty else {
            return nil
        }
        return [
            "details": details,
            "sources": parsed["sources"] as? [String: Any] ?? [:],
        ]
    }

    private static func answerRequests(
        _ requestsJson: String,
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> String {
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
            responses.append(try await send(
                "/v1/systemone",
                body: allowed,
                account: account,
                userId: userId,
                installationId: installationId,
            ))
        }
        let out = try JSONSerialization.data(withJSONObject: responses)
        return String(data: out, encoding: .utf8) ?? "[]"
    }

    static func match(
        label: String,
        section: String,
        profiles: [CipherView],
        selectedProfileId: String = "",
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> String? {
        let activeProfile = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first
        if let activeProfile,
           let localMatch = fillSingleFieldLocally(label: label, section: section, profile: activeProfile) {
            return localMatch
        }
        let request: [String: Any] = [
            "v": 1,
            "targetId": UUID().uuidString.lowercased(),
            "formSignature": "\(section)|\(label)",
            "sections": [["id": section, "label": section]],
            "fields": [["id": label, "sectionId": section, "label": label, "type": "text", "options": []]],
        ]
        let response = try await send(
            "/v1/forms/describe",
            body: request,
            account: account,
            userId: userId,
            installationId: installationId,
        )
        guard let fields = response["fields"] as? [[String: Any]], let field = fields.first else { return nil }
        let owner = (field["owner"] as? String) ?? "applicant"
        guard owner == "applicant" else { return nil }
        guard let attribute = (field["attribute"] as? String) ?? (field["detail"] as? String) ?? (field["what"] as? String),
              !attribute.isEmpty, attribute != "none" else { return nil }
        let candidates = activeProfile.map { active in [active] + profiles.filter { p in p.id != active.id } } ?? profiles
        for profile in candidates {
            if let detail = NativeProfile.details(profile).first(where: {
                ($0["attribute"] as? String) == attribute && ($0["agentRule"] as? String) != "never"
            }), let value = NativeProfile.value(detail) {
                return value
            }
        }
        return nil
    }

    static func fillSingleFieldLocally(label: String, section: String, profile: CipherView) -> String? {
        let results = fillFieldsLocally(
            fields: [[
                "id": "field_0",
                "name": "",
                "label": label,
                "placeholder": "",
                "autocomplete": "",
                "input_type": "text",
                "section": section,
                "format": "",
                "pattern": "",
                "max_length": 0,
                "form": "",
                "op_ignore": false,
            ]],
            profile: profile,
        )
        return results.first ?? nil
    }

    static func fillFieldsLocally(fields: [[String: Any]], profile: CipherView) -> [String?] {
        var held: [String: String] = [:]
        for detail in NativeProfile.details(profile) {
            guard (detail["agentRule"] as? String) != "never",
                  let value = NativeProfile.value(detail),
                  !value.isEmpty else { continue }
            if let attr = detail["attribute"] as? String, !attr.isEmpty {
                held[attr] = value
            } else if let label = detail["label"] as? String, !label.isEmpty {
                held[label] = value
            }
        }
        guard !held.isEmpty,
              let fieldsData = try? JSONSerialization.data(withJSONObject: fields),
              let fieldsJson = String(data: fieldsData, encoding: .utf8),
              let profilesData = try? JSONSerialization.data(withJSONObject: ["applicant": held]),
              let profilesJson = String(data: profilesData, encoding: .utf8),
              let outJson = try? captureFillForm(
                  fieldsJson: fieldsJson,
                  profilesJson: profilesJson,
                  choicesJson: "[]",
                  explicitFill: true,
              ),
              let outData = outJson.data(using: .utf8),
              let matches = (try? JSONSerialization.jsonObject(with: outData)) as? [[String: Any]] else {
            return Array(repeating: nil, count: fields.count)
        }
        return matches.map { item in
            guard let val = item["value"] as? String, !val.isEmpty else { return nil }
            return val
        }
    }

    static func fillPDF(data: Data, profile: CipherView) throws -> (data: Data, filledCount: Int) {
        guard let pdf = PDFDocument(data: data), pdf.pageCount > 0 else {
            throw NativeVaultError.unreadable
        }
        var widgets: [PDFAnnotation] = []
        var fieldInputs: [[String: Any]] = []

        for pageIndex in 0..<pdf.pageCount {
            guard let page = pdf.page(at: pageIndex) else { continue }
            for annotation in page.annotations {
                let rawSubtype = (annotation.type ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
                guard rawSubtype.caseInsensitiveCompare("Widget") == .orderedSame else { continue }
                if annotation.widgetFieldType == .button, annotation.widgetControlType == .pushButtonControl {
                    continue
                }
                let fieldName = annotation.fieldName ?? ""
                let humanizedName = fieldName
                    .replacingOccurrences(of: "_", with: " ")
                    .replacingOccurrences(of: ".", with: " ")
                var caption = annotation.caption ?? annotation.contents ?? ""
                if caption.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    let b = annotation.bounds
                    let labelRect = CGRect(x: max(0, b.minX - 180), y: b.minY - 4, width: 180, height: b.height + 8)
                    caption = page.selection(for: labelRect)?.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                }
                let label = caption.isEmpty ? humanizedName : "\(caption) \(humanizedName)"
                guard !label.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                let inputType: String = switch annotation.widgetFieldType {
                case .button:
                    annotation.widgetControlType == .radioButtonControl ? "radio" : "checkbox"
                case .choice:
                    "select-one"
                default:
                    "text"
                }
                let rawMaxLen = annotation.maximumLength
                let safeMaxLen = (rawMaxLen > 0 && rawMaxLen <= 4096) ? rawMaxLen : 0
                widgets.append(annotation)
                fieldInputs.append([
                    "id": fieldName.isEmpty ? "w_\(widgets.count)" : fieldName,
                    "name": fieldName,
                    "label": label,
                    "placeholder": caption,
                    "autocomplete": "",
                    "input_type": inputType,
                    "section": "",
                    "format": "",
                    "pattern": "",
                    "max_length": safeMaxLen,
                    "form": "",
                    "op_ignore": false,
                ])
            }
        }

        let values = fillFieldsLocally(fields: fieldInputs, profile: profile)
        var filledCount = 0
        for (annotation, maybeVal) in zip(widgets, values) {
            guard let val = maybeVal, !val.isEmpty else { continue }
            switch annotation.widgetFieldType {
            case .button:
                let target = (annotation.buttonWidgetStateString ?? annotation.caption ?? "").lowercased()
                let norm = val.lowercased()
                let matchesBool = ["true", "yes", "1", "on", "✓"].contains(norm)
                let matchesRadio = !target.isEmpty && (target == norm || (norm.hasPrefix("m") && target == "m") || (norm.hasPrefix("f") && target == "f"))
                if (annotation.widgetControlType == .checkBoxControl && matchesBool) || matchesRadio {
                    annotation.buttonWidgetState = .onState
                    filledCount += 1
                }
            default:
                annotation.widgetStringValue = val
                filledCount += 1
            }
        }

        guard let outData = pdf.dataRepresentation() else {
            throw NativeVaultError.unreadable
        }
        return (outData, filledCount)
    }

    private static func send(
        _ path: String,
        body: [String: Any],
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [String: Any] {
        let token = if let account, userId != nil {
            try await account.3.accountTokenProvider.getToken() ?? ""
        } else {
            try await guestToken(installationId)
        }
        guard !token.isEmpty, let url = URL(string: "https://decision.vowkey.app\(path)") else {
            throw NativeVaultError.unavailable
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) else {
            throw NativeVaultError.unavailable
        }
        return try JSONSerialization.jsonObject(with: data) as? [String: Any] ?? [:]
    }

    private static func guestToken(_ installationId: String) async throws -> String {
        guard let url = URL(string: "https://identity.vowkey.app/guest-decision/grant") else {
            throw NativeVaultError.unavailable
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["installationId": installationId])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status),
              let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String else {
            throw NativeVaultError.unavailable
        }
        return token
    }
}
