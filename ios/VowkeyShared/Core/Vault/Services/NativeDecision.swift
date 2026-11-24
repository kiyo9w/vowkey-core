import Foundation
import ImageIO
import PDFKit
import UIKit
import Vision
import VowkeySdk

/// Reads documents (text, photos, scans, PDFs, and Office files) and fills forms (photos,
/// screenshots, flat/scanned PDFs, AcroForm PDFs, and Office files) through Decision, hosted
/// vision, and Vowkey's local engine when offline.
enum NativeDecision {
    typealias Account = (CipherService, ClientService, StateService, APIService)

    private static let onDeviceOnlyDefaultsKey = "vowkey.privacy.onDeviceOnly"

    static var isOnDeviceOnlyEnabled: Bool {
        get {
            UserDefaults.standard.bool(forKey: onDeviceOnlyDefaultsKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: onDeviceOnlyDefaultsKey)
        }
    }

    private static let personScopedPrefixes = [
        "name.", "birth.", "person.", "id.", "visa.", "address.", "contact.",
        "work.", "education.", "income.", "bank.", "tax.", "family.", "custom.",
    ]

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

    struct FilledFormOutput {
        let data: Data
        let fileName: String
        let mediaType: String
        let filledCount: Int
    }

    static func isOfficeFileName(_ fileName: String) -> Bool {
        let ext = (fileName as NSString).pathExtension.lowercased()
        return ext == "docx" || ext == "xlsx" || ext == "hwpx"
    }

    static func isImageFileName(_ fileName: String, mediaType: String = "") -> Bool {
        if mediaType.lowercased().hasPrefix("image/") { return true }
        let ext = (fileName as NSString).pathExtension.lowercased()
        return ["png", "jpg", "jpeg", "heic", "heif", "webp", "tif", "tiff", "bmp"].contains(ext)
    }

    /// Straightens a photographed page before local OCR and image filling. The camera scanner
    /// already crops pages; this covers photos selected from the library that were shot at an
    /// angle. If Vision cannot find a reliable page boundary, preserve the original framing.
    private static func optimizedLocalPhotoData(_ data: Data) -> Data? {
        guard let source = UIImage(data: data) else { return nil }
        let renderFormat = UIGraphicsImageRendererFormat()
        renderFormat.scale = max(1, source.scale)
        renderFormat.opaque = true
        let normalized = UIGraphicsImageRenderer(size: source.size, format: renderFormat).image { _ in
            source.draw(in: CGRect(origin: .zero, size: source.size))
        }
        guard let cgImage = normalized.cgImage else { return normalized.pngData() }

        var corrected = CIImage(cgImage: cgImage)
        let request = VNDetectRectanglesRequest()
        request.maximumObservations = 8
        request.minimumConfidence = 0.42
        request.minimumSize = 0.32
        request.quadratureTolerance = 28
        let handler = VNImageRequestHandler(cgImage: cgImage)
        if (try? handler.perform([request])) != nil,
           let page = (request.results ?? [])
            .filter({ $0.boundingBox.width * $0.boundingBox.height > 0.28 })
            .max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height }) {
            let extent = corrected.extent
            func point(_ normalized: CGPoint) -> CIVector {
                CIVector(x: extent.minX + normalized.x * extent.width, y: extent.minY + normalized.y * extent.height)
            }
            let filter = CIFilter(name: "CIPerspectiveCorrection")
            filter?.setValue(corrected, forKey: kCIInputImageKey)
            filter?.setValue(point(page.topLeft), forKey: "inputTopLeft")
            filter?.setValue(point(page.topRight), forKey: "inputTopRight")
            filter?.setValue(point(page.bottomLeft), forKey: "inputBottomLeft")
            filter?.setValue(point(page.bottomRight), forKey: "inputBottomRight")
            if let output = filter?.outputImage, output.extent.width > 1, output.extent.height > 1 {
                corrected = output
            }
        }

        let contrast = CIFilter(name: "CIColorControls")
        contrast?.setValue(corrected, forKey: kCIInputImageKey)
        contrast?.setValue(1.12, forKey: kCIInputContrastKey)
        contrast?.setValue(1.0, forKey: kCIInputSaturationKey)
        let sharpen = CIFilter(name: "CISharpenLuminance")
        sharpen?.setValue(contrast?.outputImage ?? corrected, forKey: kCIInputImageKey)
        sharpen?.setValue(0.35, forKey: kCIInputSharpnessKey)
        let output = sharpen?.outputImage ?? corrected
        let context = CIContext(options: [.useSoftwareRenderer: false])
        guard let result = context.createCGImage(output, from: output.extent) else {
            return normalized.pngData()
        }
        return UIImage(cgImage: result).pngData()
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
        if isOfficeFileName(fileName) {
            if let extractedJson = try? captureExtractOffice(bytes: data, fileName: fileName),
               let extractedData = extractedJson.data(using: .utf8),
               let obj = (try? JSONSerialization.jsonObject(with: extractedData)) as? [String: Any],
               let text = obj["text"] as? String,
               !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return try await read(
                    text: text,
                    account: account,
                    userId: userId,
                    installationId: installationId,
                )
            }
            throw NativeVaultError.unreadable
        }

        let lower = fileName.lowercased()
        let isPDF = mediaType == "application/pdf" || lower.hasSuffix(".pdf")
        let year = UInt16(Calendar.current.component(.year, from: Date()))
        let onDeviceOnly = isOnDeviceOnlyEnabled

        async let localRecognitionTask: (pages: [RecognizedPage], extraText: String)? = Task.detached(priority: .userInitiated) {
            if isPDF {
                try? recognizePDF(data, fileName: fileName)
            } else {
                try? recognizeImage(data, fileName: fileName)
            }
        }.value

        if onDeviceOnly {
            guard let recognized = await localRecognitionTask else {
                throw NativeVaultError.unreadable
            }
            let ocrLines = recognized.pages.flatMap(\.pieces).map(\.text)
            let fullText = (ocrLines + (recognized.extraText.isEmpty ? [] : [recognized.extraText])).joined(separator: "\n")
            if let local = try? localStandardFallback(fullText: fullText, year: year) {
                return attachLocalPieceLocators(capture: local, pages: recognized.pages)
            }
            throw NativeVaultError.unreadable
        }

        async let visionTask: [String: Any]? = try? await readVision(
            data: data,
            fileName: fileName,
            isPDF: isPDF,
            account: account,
            userId: userId,
            installationId: installationId,
        )

        let recognized = await localRecognitionTask
        let visionCapture = await visionTask

        if let visionCapture {
            if let recognized {
                let ocrLines = recognized.pages.flatMap(\.pieces).map(\.text)
                let fullText = (ocrLines + (recognized.extraText.isEmpty ? [] : [recognized.extraText])).joined(separator: "\n")
                if let local = try? localStandardFallback(fullText: fullText, year: year) {
                    let localWithBoxes = attachLocalPieceLocators(capture: local, pages: recognized.pages)
                    let merged = mergeCapturedDocuments(primary: localWithBoxes, vision: visionCapture)
                    return attachLocalPieceLocators(capture: merged, pages: recognized.pages)
                }
                return attachLocalPieceLocators(capture: visionCapture, pages: recognized.pages)
            }
            return visionCapture
        }

        if let recognized,
           recognized.pages.contains(where: { !$0.pieces.isEmpty }) || !recognized.extraText.isEmpty,
           let fallbackCapture = try? await readPages(
               recognized.pages,
               extraText: recognized.extraText,
               account: account,
               userId: userId,
               installationId: installationId,
           ) {
            return attachLocalPieceLocators(capture: fallbackCapture, pages: recognized.pages)
        }
        throw NativeVaultError.unreadable
    }

    private static func attachLocalPieceLocators(
        capture: [String: Any],
        pages: [RecognizedPage],
    ) -> [String: Any] {
        guard let details = capture["details"] as? [String: String], !details.isEmpty else {
            return capture
        }
        var sources = capture["sources"] as? [String: [String: Any]] ?? [:]
        for (key, rawVal) in details {
            if sources[key]?["locator"] != nil { continue }
            let needle = rawVal.trimmingCharacters(in: .whitespacesAndNewlines)
            guard needle.count >= 2 else { continue }
            let compactNeedle = needle.replacingOccurrences(of: " ", with: "").lowercased()
            var matchedBox: [String: Any]?
            for page in pages {
                if let hit = page.pieces.first(where: { piece in
                    let pText = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
                    if pText.localizedCaseInsensitiveContains(needle) { return true }
                    let pCompact = pText.replacingOccurrences(of: " ", with: "").lowercased()
                    return compactNeedle.count >= 4 && pCompact.contains(compactNeedle)
                }) {
                    matchedBox = [
                        "kind": "page",
                        "page": page.index,
                        "x": hit.x,
                        "y": hit.y,
                        "w": hit.w,
                        "h": hit.h,
                    ]
                    break
                }
            }
            if let matchedBox {
                var entry = sources[key] ?? ["kind": "ocr", "verified": false]
                entry["locator"] = matchedBox
                sources[key] = entry
            }
        }
        return ["details": details, "sources": sources]
    }

    private static func mergeCapturedDocuments(
        primary: [String: Any],
        vision: [String: Any],
    ) -> [String: Any] {
        var details = vision["details"] as? [String: String] ?? [:]
        var sources = vision["sources"] as? [String: [String: Any]] ?? [:]
        let primaryDetails = primary["details"] as? [String: String] ?? [:]
        let primarySources = primary["sources"] as? [String: [String: Any]] ?? [:]

        for (key, val) in primaryDetails {
            let trimmed = val.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            let src = primarySources[key] ?? [:]
            let isVerified = (src["verified"] as? Bool) == true
            if isVerified || details[key] == nil {
                details[key] = trimmed
                if var mergedSrc = sources[key] {
                    if isVerified {
                        mergedSrc["verified"] = true
                        if let kind = src["kind"] { mergedSrc["kind"] = kind }
                    }
                    if mergedSrc["locator"] == nil, let loc = src["locator"] {
                        mergedSrc["locator"] = loc
                    }
                    sources[key] = mergedSrc
                } else {
                    sources[key] = src
                }
            } else if sources[key]?["locator"] == nil, let loc = src["locator"] {
                var mergedSrc = sources[key] ?? ["kind": "ocr", "verified": false]
                mergedSrc["locator"] = loc
                sources[key] = mergedSrc
            }
        }
        return ["details": details, "sources": sources]
    }

    static func recognizeImage(
        _ data: Data,
        fileName: String = "document.jpg",
    ) throws -> (pages: [RecognizedPage], extraText: String) {
        var extraChunks: [String] = []
        if let decodedJson = try? captureDecodeBarcode(imageBytes: data),
           let decodedData = decodedJson.data(using: .utf8),
           let decoded = (try? JSONSerialization.jsonObject(with: decodedData)) as? [String: Any],
           let barcodeText = decoded["text"] as? String,
           !barcodeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            extraChunks.append(barcodeText)
        }

        if let enginePages = try? recognizeWithDocumentEngine(data: data, fileName: fileName),
           enginePages.contains(where: { !$0.pieces.isEmpty }) {
            if let source = CGImageSourceCreateWithData(data as CFData, nil),
               let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) {
                let (_, visionBarcodes) = (try? runVision(on: cgImage, orientation: .up)) ?? ([], [])
                extraChunks.append(contentsOf: visionBarcodes)
            }
            return (pages: enginePages, extraText: extraChunks.joined(separator: "\n"))
        }

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
        extraChunks.append(contentsOf: barcodes)
        let aspect = Double(width) / Double(height)
        return (
            pages: [RecognizedPage(index: 0, aspect: aspect, pieces: pieces)],
            extraText: extraChunks.joined(separator: "\n"),
        )
    }

    static func recognizePDF(
        _ data: Data,
        fileName: String = "document.pdf",
    ) throws -> (pages: [RecognizedPage], extraText: String) {
        guard let pdf = PDFDocument(data: data), pdf.pageCount > 0 else {
            throw NativeVaultError.unreadable
        }
        var extraChunks: [String] = []
        let count = min(pdf.pageCount, 8)
        for index in 0..<count {
            if let pageString = pdf.page(at: index)?.string?.trimmingCharacters(in: .whitespacesAndNewlines),
               !pageString.isEmpty {
                extraChunks.append(pageString)
            }
        }
        if let enginePages = try? recognizeWithDocumentEngine(data: data, fileName: fileName),
           enginePages.contains(where: { !$0.pieces.isEmpty }) {
            return (pages: enginePages, extraText: extraChunks.joined(separator: "\n"))
        }

        var pages: [RecognizedPage] = []
        for index in 0..<count {
            guard let page = pdf.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let aspect = bounds.height > 0 ? Double(bounds.width / bounds.height) : 0.707
            let thumb = page.thumbnail(of: CGSize(width: 1600, height: 2200), for: .mediaBox)
            if let cgImage = thumb.cgImage {
                let (pieces, barcodes) = try runVision(on: cgImage, orientation: .up)
                pages.append(RecognizedPage(index: index, aspect: aspect, pieces: pieces))
                extraChunks.append(contentsOf: barcodes)
            }
        }
        return (pages: pages, extraText: extraChunks.joined(separator: "\n"))
    }

    private static func recognizeWithDocumentEngine(
        data: Data,
        fileName: String,
    ) throws -> [RecognizedPage] {
        let ext = ((fileName as NSString).pathExtension).isEmpty ? "jpg" : (fileName as NSString).pathExtension
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("vk_read_\(UUID().uuidString.lowercased()).\(ext)")
        defer { try? FileManager.default.removeItem(at: tempURL) }
        try data.write(to: tempURL, options: .atomic)
        let payload = try VowkeyDocumentEngine.pieces(url: tempURL)
        guard let rawPages = payload["pages"] as? [[String: Any]] else { return [] }
        return rawPages.enumerated().map { idx, pageDict in
            let pageIndex = (pageDict["index"] as? Int) ?? idx
            let aspect = (pageDict["aspect"] as? Double) ?? 0.707
            let rawPieces = pageDict["pieces"] as? [[String: Any]] ?? []
            let pieces: [RecognizedPiece] = rawPieces.compactMap { p in
                guard let text = (p["text"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !text.isEmpty else { return nil }
                let loc = p["locator"] as? [String: Any]
                let x = (p["x"] as? Double) ?? (loc?["x"] as? Double) ?? 0
                let y = (p["y"] as? Double) ?? (loc?["y"] as? Double) ?? 0
                let w = (p["w"] as? Double) ?? (loc?["w"] as? Double) ?? 0.1
                let h = (p["h"] as? Double) ?? (loc?["h"] as? Double) ?? 0.02
                let conf = (p["confidence"] as? Double) ?? 1.0
                return RecognizedPiece(text: text, x: x, y: y, w: w, h: h, confidence: conf)
            }
            return RecognizedPage(index: pageIndex, aspect: aspect, pieces: pieces)
        }
    }

    /// Reads the pages with the hosted vision reader, which looks at each page's own image.
    private static func readVision(
        data: Data,
        fileName: String,
        isPDF: Bool,
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [String: Any] {
        var details: [String: String] = [:]
        var sources: [String: [String: Any]] = [:]
        let pdf = isPDF ? PDFDocument(data: data) : nil
        let image = isPDF ? nil : UIImage(data: data)
        let pageCount = min(pdf?.pageCount ?? (image == nil ? 0 : 1), 8)
        guard pageCount > 0 else { throw NativeVaultError.unreadable }
        for index in 0..<pageCount {
            let imageDataUrl = autoreleasepool { () -> String? in
                let page: UIImage
                if let pdf {
                    guard let pdfPage = pdf.page(at: index) else { return nil }
                    page = pdfPage.thumbnail(of: CGSize(width: 1800, height: 2200), for: .mediaBox)
                } else if let image {
                    page = image
                } else {
                    return nil
                }
                return pageDataUrl(page)
            }
            guard let imageDataUrl else { throw NativeVaultError.unreadable }
            let response = try await send(
                "/v1/documents/read-vision",
                body: ["v": 1, "imageDataUrl": imageDataUrl, "fileName": fileName],
                account: account,
                userId: userId,
                installationId: installationId,
            )
            let locators = response["locators"] as? [String: [String: Any]] ?? [:]
            for (key, value) in response["details"] as? [String: Any] ?? [:] {
                guard let text = value as? String,
                      !key.isEmpty,
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                      details[key] == nil else { continue }
                details[key] = text
                var source: [String: Any] = ["kind": "ocr", "verified": false]
                if let locator = locators[key],
                   let x = locator["x"] as? Double,
                   let y = locator["y"] as? Double,
                   let w = locator["w"] as? Double,
                   let h = locator["h"] as? Double,
                   x.isFinite, y.isFinite, w.isFinite, h.isFinite,
                   x >= 0, y >= 0, w > 0, h > 0, x + w <= 1.001, y + h <= 1.001 {
                    let box: [String: Any] = ["kind": "page", "page": index, "x": x, "y": y, "w": w, "h": h]
                    source["locator"] = box
                }
                sources[key] = source
            }
        }
        guard !details.isEmpty else { throw NativeVaultError.unreadable }
        return ["details": details, "sources": sources]
    }

    /// One page as an upright JPEG data URL, scaled to stay well inside the relay's image limit.
    private static func pageDataUrl(_ image: UIImage) -> String? {
        var page = image
        let longest = max(image.size.width, image.size.height)
        let scale = longest > 2000 ? (2000 / longest) : 1.0
        if longest > 2000 || image.imageOrientation != .up {
            let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let format = UIGraphicsImageRendererFormat.default()
            format.scale = 1
            page = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                image.draw(in: CGRect(origin: .zero, size: size))
            }
        }
        guard let jpeg = page.jpegData(compressionQuality: 0.86) else { return nil }
        return "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
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

    static func heldDetails(from profile: CipherView) -> [String: String] {
        var held: [String: String] = [:]
        for detail in NativeProfile.details(profile) {
            guard (detail["agentRule"] as? String) != "never" else { continue }
            let attr = (detail["attribute"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let label = (detail["label"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if let primary = NativeProfile.value(detail), !primary.isEmpty {
                if !attr.isEmpty {
                    held[attr] = primary
                } else if !label.isEmpty {
                    held[label] = primary
                }
            }
            if !attr.isEmpty, let variants = detail["variants"] as? [[String: Any]] {
                for variant in variants where (variant["current"] as? Bool) != false {
                    guard let v = variant["value"] as? String, !v.isEmpty else { continue }
                    let script = variant["script"] as? String
                    let tag = variant["tag"] as? String
                    if script == "Latn", held["\(attr).latin"] == nil {
                        held["\(attr).latin"] = v
                    } else if script == "Kana", tag == "halfwidth", held["\(attr).halfwidth_kana"] == nil {
                        held["\(attr).halfwidth_kana"] = v
                    } else if script == "Kana", held["\(attr).kana"] == nil {
                        held["\(attr).kana"] = v
                    } else if script == "Hira", held["\(attr).hiragana"] == nil {
                        held["\(attr).hiragana"] = v
                    } else if script == "Hani", held["\(attr).kanji"] == nil {
                        held["\(attr).kanji"] = v
                    } else if tag == "wareki", held["\(attr).wareki"] == nil {
                        held["\(attr).wareki"] = v
                    }
                }
            }
        }
        return held
    }

    static func roleProfilesMap(
        profiles: [CipherView],
        selectedProfileId: String,
        cards: [CipherView] = [],
    ) -> (roles: [String: [String: String]], flatDetails: [String: String]) {
        guard let active = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first else {
            return ([:], [:])
        }
        var primaryHeld = heldDetails(from: active)
        for cardCipher in cards where NativeCipher.agentRule(for: cardCipher, defaultRule: "ask") != "never" {
            guard let card = cardCipher.card else { continue }
            if let num = card.number?.trimmingCharacters(in: .whitespacesAndNewlines), !num.isEmpty, primaryHeld["card.number"] == nil {
                primaryHeld["card.number"] = num
            }
            if let holder = card.cardholderName?.trimmingCharacters(in: .whitespacesAndNewlines), !holder.isEmpty, primaryHeld["card.holder"] == nil {
                primaryHeld["card.holder"] = holder
            }
            let exp = [card.expMonth, card.expYear].compactMap(\.self).filter { !$0.isEmpty }.joined(separator: "/")
            if !exp.isEmpty, primaryHeld["card.expiry"] == nil {
                primaryHeld["card.expiry"] = exp
            }
            if let brand = card.brand?.trimmingCharacters(in: .whitespacesAndNewlines), !brand.isEmpty, primaryHeld["card.brand"] == nil {
                primaryHeld["card.brand"] = brand
            }
        }
        var roleMap: [String: [String: String]] = ["applicant": primaryHeld]
        if let flatData = try? JSONSerialization.data(withJSONObject: primaryHeld),
           let flatJson = String(data: flatData, encoding: .utf8),
           let expandedJson = try? captureProfilesFromFlat(profileJson: flatJson),
           let expandedData = expandedJson.data(using: .utf8),
           let expanded = (try? JSONSerialization.jsonObject(with: expandedData)) as? [String: [String: String]] {
            roleMap = expanded
        }

        var dependentIndex = roleMap["dependent"] == nil ? 1 : 2
        var memberIndex = 2
        for other in profiles where other.id != active.id {
            let otherHeld = heldDetails(from: other)
            guard !otherHeld.isEmpty else { continue }
            let metaRel = ((try? NativeProfile.metadata(other)["relationship"]) as? String ?? "").lowercased()
            let hint = "\(other.name.lowercased()) \(metaRel) \((otherHeld["household_head.relation"] ?? "").lowercased())"
            let role: String
            if ["spouse", "wife", "husband", "partner", "配偶者", "妻", "夫", "vợ", "chồng"].contains(where: { hint.contains($0) }) {
                role = "spouse"
            } else if ["child", "dependent", "son", "daughter", "子", "長男", "長女", "con"].contains(where: { hint.contains($0) }) {
                role = dependentIndex == 1 ? "dependent" : "dependent.\(dependentIndex)"
                dependentIndex += 1
            } else if ["head", "世帯主", "chủ hộ"].contains(where: { hint.contains($0) }) {
                role = "household_head"
            } else if ["parent", "father", "mother", "父", "母", "cha", "mẹ"].contains(where: { hint.contains($0) }) {
                role = "parent"
            } else if ["guardian", "保護者", "giám hộ"].contains(where: { hint.contains($0) }) {
                role = "guardian"
            } else {
                role = "household_member.\(memberIndex)"
                memberIndex += 1
            }
            var merged = roleMap[role] ?? [:]
            for (k, v) in otherHeld where merged[k] == nil {
                merged[k] = v
            }
            roleMap[role] = merged
        }

        var flatDetails = primaryHeld
        for (role, map) in roleMap where role != "applicant" {
            for (k, v) in map where !v.isEmpty {
                let prefixed = k.hasPrefix("\(role).") ? k : "\(role).\(k)"
                if flatDetails[prefixed] == nil {
                    flatDetails[prefixed] = v
                }
            }
        }
        return (roleMap, flatDetails)
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
        guard owner != "official_only" else { return nil }
        guard let attribute = (field["attribute"] as? String) ?? (field["detail"] as? String) ?? (field["what"] as? String),
              !attribute.isEmpty, attribute != "none" else { return nil }
        let (roleMap, _) = roleProfilesMap(profiles: profiles, selectedProfileId: selectedProfileId)
        if let roleDict = roleMap[owner], let val = roleDict[attribute], !val.isEmpty {
            return val
        }
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
        let held = heldDetails(from: profile)
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

    /// Fills any form file (photographed/screenshotted form image, flat/scanned PDF, interactive
    /// AcroForm PDF, or `.docx`/`.xlsx`/`.hwpx` Office file) with Mac-parity hybrid accuracy.
    static func fillFormFile(
        data: Data,
        fileName: String,
        profiles: [CipherView],
        cards: [CipherView] = [],
        selectedProfileId: String = "",
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> FilledFormOutput {
        guard profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first != nil else {
            throw NativeVaultError.emptyProfileDetails
        }
        let (roleMap, flatDetails) = roleProfilesMap(
            profiles: profiles,
            selectedProfileId: selectedProfileId,
            cards: cards,
        )
        guard !flatDetails.isEmpty else {
            throw NativeVaultError.emptyProfileDetails
        }

        if isOfficeFileName(fileName) {
            return try await fillOfficeFormFile(
                data: data,
                fileName: fileName,
                flatDetails: flatDetails,
                roleMap: roleMap,
                account: account,
                userId: userId,
                installationId: installationId,
            )
        }

        let ext = ((fileName as NSString).pathExtension).lowercased()
        let isPDF = ext == "pdf" || (!isImageFileName(fileName) && PDFDocument(data: data) != nil)
        let stem = ((fileName as NSString).deletingPathExtension).isEmpty
            ? "form"
            : (fileName as NSString).deletingPathExtension
        let inExt = isPDF ? "pdf" : (ext.isEmpty ? "jpg" : ext)
        let outExt = isPDF ? "pdf" : ((ext == "jpg" || ext == "jpeg") ? "jpg" : "png")
        let outMime = isPDF ? "application/pdf" : (outExt == "jpg" ? "image/jpeg" : "image/png")
        let onDeviceOnly = isOnDeviceOnlyEnabled
        let formData = !isPDF && onDeviceOnly ? (optimizedLocalPhotoData(data) ?? data) : data

        let tempInURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("vk_form_in_\(UUID().uuidString.lowercased()).\(inExt)")
        let tempOutURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("vk_form_out_\(UUID().uuidString.lowercased()).\(outExt)")
        defer {
            try? FileManager.default.removeItem(at: tempInURL)
            try? FileManager.default.removeItem(at: tempOutURL)
        }
        try formData.write(to: tempInURL, options: .atomic)

        let imageDataUrlForPlan: String? = (!isPDF && !onDeviceOnly)
            ? autoreleasepool { UIImage(data: formData).flatMap(pageDataUrl) }
            : nil

        async let localLayoutTask: (formPayload: [String: Any], piecesJson: String) = Task.detached(priority: .userInitiated) {
            let payload = (try? VowkeyDocumentEngine.form(url: tempInURL)) ?? [:]
            let piecesJson = isPDF ? "[]" : recognizeFormPiecesJson(from: formData)
            return (payload, piecesJson)
        }.value

        async let remoteImageResponseTask: [String: Any]? = {
            guard let imageDataUrlForPlan else { return nil }
            var cleanDetails: [String: String] = [:]
            for (k, v) in flatDetails {
                let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
                if !k.isEmpty, !t.isEmpty { cleanDetails[k] = t }
            }
            guard !cleanDetails.isEmpty else { return nil }
            return try await send(
                "/v1/forms/fill-image",
                body: ["v": 1, "imageDataUrl": imageDataUrlForPlan, "fileName": fileName, "details": cleanDetails],
                account: account,
                userId: userId,
                installationId: installationId,
            )
        }()

        let (formPayload, precomputedPiecesJson) = await localLayoutTask
        let remoteImageResponse = try? await remoteImageResponseTask

        let rawFields = (formPayload["fields"] as? [[String: Any]] ?? []).filter { f in
            guard let t = f["type"] as? String else { return false }
            return t == "text" || t == "select-one" || t == "checkbox" || t == "radio"
        }

        var inputs: [[String: Any]] = rawFields.map { f in
            let key = (f["key"] as? String) ?? ""
            let name = (f["name"] as? String) ?? ""
            let tooltip = (f["tooltip"] as? String) ?? ""
            let label = (f["label"] as? String) ?? ""
            let joinedLabel = [tooltip, label, name]
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " — ")
            let rawType = (f["type"] as? String) ?? "text"
            let maxLen = max(0, (f["maxLength"] as? Int) ?? 0)
            let options = (f["options"] as? [String]) ?? []
            return [
                "id": name.isEmpty ? key : name,
                "name": name,
                "label": joinedLabel.isEmpty ? key : joinedLabel,
                "placeholder": "",
                "autocomplete": "",
                "input_type": rawType,
                "section": (f["section"] as? String) ?? "",
                "form": "",
                "pattern": "",
                "max_length": maxLen,
                "format": "",
                "op_ignore": false,
                "options": options,
            ]
        }

        var matches = runCaptureFillForm(inputs: inputs, roleMap: roleMap, choices: [])
        var plannedImageFields: [PlannedImageField] = []
        if !isPDF, let remoteImageResponse {
            plannedImageFields = snapPlannedImageFields(
                response: remoteImageResponse,
                imageData: formData,
                piecesJson: precomputedPiecesJson,
                page: 0,
            )
        } else if isPDF, !onDeviceOnly, (formPayload["interactive"] as? Bool) != true {
            plannedImageFields = try await planFlatPdfImageFillFields(
                pdfData: data,
                fileName: fileName,
                flatDetails: flatDetails,
                account: account,
                userId: userId,
                installationId: installationId,
            )
        }

        let unresolvedIndices = inputs.indices.filter { idx in
            if plannedImageFields.count >= 5, idx < rawFields.count {
                let key = (rawFields[idx]["key"] as? String) ?? ""
                if !key.contains(":comb:") {
                    return false
                }
            }
            guard idx < matches.count else { return true }
            let val = (matches[idx]["value"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let score = (matches[idx]["score"] as? Double) ?? 0
            return val.isEmpty || score < 0.85
        }

        if !onDeviceOnly, !unresolvedIndices.isEmpty {
            if let choices = try? await describeUnresolvedFields(
                fileName: fileName,
                inputs: &inputs,
                rawFields: rawFields,
                unresolvedIndices: unresolvedIndices,
                roleMap: roleMap,
                account: account,
                userId: userId,
                installationId: installationId,
            ), !choices.isEmpty {
                matches = runCaptureFillForm(inputs: inputs, roleMap: roleMap, choices: choices)
            }
        }

        var values: [String: String] = [:]
        for (idx, field) in rawFields.enumerated() where idx < matches.count {
            guard let key = field["key"] as? String,
                  let val = (matches[idx]["value"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !val.isEmpty else { continue }
            values[key] = val
        }

        if !isPDF,
           let familiarForm = familiarPhotoForm(fields: rawFields, piecesJson: precomputedPiecesJson) {
            let curated = familiarPhotoFormValues(familiarForm, fields: rawFields, roles: roleMap)
            if !curated.isEmpty {
                values = curated
                plannedImageFields = []
            }
        }

        if !plannedImageFields.isEmpty {
            if plannedImageFields.count >= 5 {
                for existingKey in Array(values.keys) {
                    if !existingKey.contains(":comb:") {
                        values.removeValue(forKey: existingKey)
                    }
                }
            }
            var existingBoxes: [(key: String, page: Int, x: Double, y: Double, w: Double, h: Double)] = values.keys.compactMap { k in
                let p = k.split(separator: ":")
                guard p.count >= 6, p[0] == "box",
                      let pg = Int(p[1]),
                      let x = Double(p[2]), let y = Double(p[3]),
                      let w = Double(p[4]), let h = Double(p[5]) else { return nil }
                return (k, pg, x, y, w, h)
            }

            for pf in plannedImageFields {
                let bx = pf.x
                let bottomY = max(0, min(1, 1.0 - pf.top - pf.h))
                let bw = pf.w
                let bh = pf.h
                let overlapping = existingBoxes.filter { er in
                    guard er.page == pf.page else { return false }
                    let ix = max(0, min(bx + bw, er.x + er.w) - max(bx, er.x))
                    let iy = max(0, min(bottomY + bh, er.y + er.h) - max(bottomY, er.y))
                    let inter = ix * iy
                    guard inter > 0 else { return false }
                    let minArea = max(1e-6, min(bw * bh, er.w * er.h))
                    return inter / minArea >= 0.25
                }
                if overlapping.contains(where: { $0.key.contains(":comb:") }) {
                    continue
                }
                for er in overlapping {
                    values.removeValue(forKey: er.key)
                }
                var key = String(format: "box:%d:%.4f:%.4f:%.4f:%.4f", pf.page, bx, bottomY, bw, bh)
                var val = pf.value
                if pf.action == "circle" {
                    key += ":circle"
                } else if pf.action == "check" {
                    key += ":check"
                    val = "✓"
                } else if let comb = pf.comb, comb >= 2 {
                    key += ":vlm:comb:\(comb)"
                } else {
                    key += ":vlm"
                }
                values[key] = val
                existingBoxes.append((key, pf.page, bx, bottomY, bw, bh))
            }
        }

        if !values.isEmpty,
           let count = try? VowkeyDocumentEngine.fill(sourceURL: tempInURL, outURL: tempOutURL, values: values),
           count > 0,
           let outBytes = try? Data(contentsOf: tempOutURL) {
            return FilledFormOutput(
                data: outBytes,
                fileName: "\(stem) (filled).\(outExt)",
                mediaType: outMime,
                filledCount: count,
            )
        }

        if isPDF, let activeProfile = profiles.first(where: { $0.id == selectedProfileId }) ?? profiles.first {
            let (fallbackBytes, fallbackCount) = try fillPDF(data: data, profile: activeProfile)
            return FilledFormOutput(
                data: fallbackBytes,
                fileName: "\(stem) (filled).pdf",
                mediaType: "application/pdf",
                filledCount: fallbackCount,
            )
        }

        return FilledFormOutput(
            data: data,
            fileName: "\(stem) (filled).\(outExt)",
            mediaType: outMime,
            filledCount: 0,
        )
    }

    private enum FamiliarPhotoForm: Equatable {
        case vietnamResidenceChange
        case japanResidenceCardChange
        case japanMarriage
    }

    private static func familiarPhotoForm(
        fields: [[String: Any]],
        piecesJson: String,
    ) -> FamiliarPhotoForm? {
        let labels = fields.compactMap { $0["label"] as? String }.joined(separator: " ")
        let pieceText: String = {
            guard let data = piecesJson.data(using: .utf8),
                  let pieces = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else {
                return ""
            }
            return pieces.compactMap { $0["text"] as? String }.joined(separator: " ")
        }()
        let text = (labels + " " + pieceText)
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "vi_VN"))
            .lowercased()
        if text.contains("to khai thay doi thong tin cu tru") ||
           (text.contains("ten khai sinh") && text.contains("chu ho")) {
            return .vietnamResidenceChange
        }
        if text.contains("notification of a change of an item") ||
           text.contains("在留カード記載事項変更") ||
           (text.contains("residence card number") && text.contains("previous item")) {
            return .japanResidenceCardChange
        }
        if text.contains("婚姻届") ||
           (text.contains("registered domicile") && text.contains("occupation") && text.contains("passport number")) {
            return .japanMarriage
        }
        return nil
    }

    private static func familiarPhotoFormValues(
        _ form: FamiliarPhotoForm,
        fields: [[String: Any]],
        roles: [String: [String: String]],
    ) -> [String: String] {
        var output: [String: String] = [:]
        func detail(_ names: String..., role: String = "applicant") -> String? {
            for name in names {
                if let value = roles[role]?[name]?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !value.isEmpty { return value }
            }
            return nil
        }
        func add(_ key: String, _ value: String?) {
            guard let value, !value.isEmpty else { return }
            output[key] = value
        }
        func vietnameseSex(_ value: String?) -> String? {
            guard let value else { return nil }
            switch value.lowercased() {
            case "男", "m", "male", "nam": return "Nam"
            case "女", "f", "female", "nữ", "nu": return "Nữ"
            default: return value
            }
        }
        func vietnameseDate(_ value: String?) -> String? {
            guard let value else { return nil }
            let parts = value.split(separator: "-")
            return parts.count == 3 ? "\(parts[2])/\(parts[1])/\(parts[0])" : value
        }

        for field in fields {
            guard let key = field["key"] as? String,
                  let originalLabel = field["label"] as? String else { continue }
            let label = originalLabel
                .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "vi_VN"))
                .lowercased()
            let section = ((field["section"] as? String) ?? "").lowercased()

            switch form {
            case .vietnamResidenceChange:
                if let marker = section.split(separator: "#").last,
                   section.contains("#"),
                   let row = Int(marker.trimmingCharacters(in: .whitespaces)),
                   row == 1 || row == 2 {
                    let role = row == 1 ? "spouse" : "dependent"
                    if label.contains("ho, chu dem va ten") {
                        add(key, detail("name.full", "name.full.latin", role: role))
                        let parts = key.split(separator: ":")
                        if parts.count >= 6 {
                            let relation = row == 1 ? "Vợ" : "Con"
                            output["box:0:0.7650:\(parts[3]):0.1700:\(parts[5]):cell"] = relation
                        }
                    } else if label.contains("ngay, thang, nam sinh") {
                        add(key, vietnameseDate(detail("birth.date", role: role)))
                    } else if label.contains("gioi tinh") {
                        add(key, vietnameseSex(detail("person.sex", role: role)))
                    } else if label.contains("so dinh danh ca nhan") {
                        add(key, detail("id.national.number", role: role))
                    }
                    continue
                }
                if label.contains("kinh gui") {
                    add(key, detail("residence.request.office"))
                } else if label.contains("ten khai sinh") {
                    add(key, detail("name.full", "name.full.latin"))
                } else if label.contains("ngay, thang, nam sinh") {
                    add(key, detail("birth.date"))
                } else if label.contains("gioi tinh") {
                    add(key, vietnameseSex(detail("person.sex")))
                } else if label.contains("so dinh danh ca nhan cua chu ho") {
                    add(key, detail("household.head.national_id"))
                } else if label.contains("so dinh danh ca nhan") {
                    add(key, detail("id.national.number"))
                } else if label.contains("so dien thoai lien he") {
                    add(key, detail("contact.phone"))
                } else if label.contains("email") {
                    add(key, detail("contact.email"))
                } else if label.contains("ten chu ho") {
                    add(key, detail("household.head.name"))
                } else if label.contains("moi quan he voi chu ho") {
                    add(key, detail("household.relationship"))
                } else if label.contains("noi dung de nghi") {
                    add(key, detail("residence.change.request"))
                }

            case .japanResidenceCardChange:
                if section.contains("representative") || section.contains("agent or other authorized") ||
                   section.contains("signature") || section.contains("代理人") || section.contains("取次者") {
                    continue
                }
                if label.contains("nationality / region") {
                    add(key, detail("person.nationality"))
                } else if label.contains("date of birth") {
                    add(key, detail("birth.date"))
                } else if label.contains("sex") {
                    add(key, detail("person.sex"))
                } else if label.contains("family name") {
                    add(key, detail("name.family.latin", "name.family"))
                } else if label.contains("given name") {
                    add(key, detail("name.given.latin", "name.given"))
                } else if label.contains("address in japan") {
                    add(key, detail("address.full"))
                } else if label.contains("residence card number") {
                    add(key, detail("id.residence_card.number"))
                } else if label.contains("previous item") {
                    add(key, detail("residence_change.previous_value"))
                } else if label.contains("変更後") {
                    add(key, detail("residence_change.new_value"))
                } else if label == "電話番号" || label == "携帯電話番号" {
                    add(key, detail("contact.phone"))
                }

            case .japanMarriage:
                if label.contains("full name") {
                    add(key, detail("name.full.kanji", "name.full.latin", "name.full"))
                } else if label.contains("reading") {
                    add(key, detail("name.full.kana", "name.full.latin", "name.full"))
                } else if label.contains("date of birth") {
                    add(key, detail("birth.date.wareki", "birth.date"))
                } else if label.contains("nationality") {
                    add(key, detail("person.nationality"))
                } else if label.contains("current address") {
                    add(key, detail("address.full"))
                } else if label.contains("registered domicile") {
                    add(key, detail("address.registered_domicile"))
                } else if label.contains("occupation") {
                    add(key, detail("work.occupation"))
                } else if label.contains("employer") {
                    add(key, detail("work.employer.name"))
                } else if label.contains("phone number") {
                    add(key, detail("contact.phone"))
                } else if label.contains("email address") {
                    add(key, detail("contact.email"))
                } else if label.contains("residence card no") {
                    add(key, detail("id.residence_card.number"))
                } else if label.contains("passport number") {
                    add(key, detail("id.passport.number"))
                }
            }
        }

        if form == .japanResidenceCardChange,
           let previous = fields.first(where: {
               (($0["label"] as? String) ?? "").contains("Previous item")
           }),
           let previousKey = previous["key"] as? String {
            let parts = previousKey.split(separator: ":")
            if parts.count >= 6,
               let left = Double(parts[2]), let bottom = Double(parts[3]),
               let width = Double(parts[4]),
               let birthField = fields.first(where: {
                   (($0["label"] as? String) ?? "").contains("Date of birth")
               }),
               let birthKey = birthField["key"] as? String {
                let birthParts = birthKey.split(separator: ":")
                if birthParts.count >= 6, let birthBottom = Double(birthParts[3]) {
                    let sx = width / 0.7751
                    let sy = (birthBottom - bottom) / (0.7383 - 0.5392)
                    func x(_ reference: Double) -> Double { left + (reference - 0.1649) * sx }
                    func y(_ reference: Double) -> Double { bottom + (reference - 0.5392) * sy }
                    func overlayKey(_ xRef: Double, _ yRef: Double, _ wRef: Double, _ hRef: Double, _ suffix: String = "") -> String {
                        String(format: "box:0:%.4f:%.4f:%.4f:%.4f", x(xRef), y(yRef), wRef * sx, hRef * sy) + suffix
                    }
                    if detail("residence_change.previous_value") != nil,
                       detail("residence_change.new_value") != nil {
                        output[overlayKey(0.077, 0.601, 0.016, 0.013, ":check")] = "✓"
                        if let changedOn = detail("residence_change.date") {
                            let slots = String(format: ":slots:%.4f,%.4f;%.4f,%.4f;%.4f,%.4f",
                                               x(0.7049), 0.10 * sx,
                                               x(0.8100), 0.06 * sx,
                                               x(0.9000), 0.04 * sx)
                            output[overlayKey(0.7049, 0.588, 0.2351, 0.023, slots)] = changedOn
                        }
                    }
                    let today = DateFormatter()
                    today.calendar = Calendar(identifier: .gregorian)
                    today.locale = Locale(identifier: "en_US_POSIX")
                    today.dateFormat = "yyyy-MM-dd"
                    let filingSlots = String(format: ":slots:%.4f,%.4f;%.4f,%.4f;%.4f,%.4f",
                                             x(0.687), 0.10 * sx,
                                             x(0.785), 0.06 * sx,
                                             x(0.877), 0.05 * sx)
                    output[overlayKey(0.687, 0.355, 0.24, 0.023, filingSlots)] = today.string(from: Date())
                }
            }
        }
        return output
    }

    private struct PlannedImageField {
        let page: Int
        let sourceKey: String
        let label: String
        let value: String
        let x: Double
        let top: Double
        let w: Double
        let h: Double
        let comb: Int?
        let action: String
    }

    private static func recognizeFormPiecesJson(from data: Data) -> String {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return "[]"
        }
        let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
        let rawOrientation = (properties?[kCGImagePropertyOrientation] as? UInt32) ?? 1
        let orientation = CGImagePropertyOrientation(rawValue: rawOrientation) ?? .up
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = true
        if #available(iOS 16.0, *) {
            req.automaticallyDetectsLanguage = true
        }
        let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
        guard (try? handler.perform([req])) != nil else { return "[]" }
        let pieceBoxes: [[String: Any]] = (req.results ?? []).compactMap { obs in
            guard let top = obs.topCandidates(1).first else { return nil }
            let text = top.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { return nil }
            let b = obs.boundingBox
            return [
                "text": text,
                "left": Double(max(0, min(1, b.minX))),
                "top": Double(max(0, min(1, 1.0 - b.maxY))),
                "width": Double(max(0, min(1, b.width))),
                "height": Double(max(0, min(1, b.height))),
            ]
        }
        guard let pbData = try? JSONSerialization.data(withJSONObject: pieceBoxes),
              let pbStr = String(data: pbData, encoding: .utf8) else {
            return "[]"
        }
        return pbStr
    }

    private static func planFlatPdfImageFillFields(
        pdfData: Data,
        fileName: String,
        flatDetails: [String: String],
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [PlannedImageField] {
        guard let pdf = PDFDocument(data: pdfData), pdf.pageCount > 0 else { return [] }
        var cleanDetails: [String: String] = [:]
        for (k, v) in flatDetails {
            let t = v.trimmingCharacters(in: .whitespacesAndNewlines)
            if !k.isEmpty, !t.isEmpty { cleanDetails[k] = t }
        }
        guard !cleanDetails.isEmpty else { return [] }
        let pageCount = min(pdf.pageCount, 3)
        var allPlanned: [PlannedImageField] = []
        for pageIndex in 0..<pageCount {
            guard let page = pdf.page(at: pageIndex) else { continue }
            let rendered = page.thumbnail(of: CGSize(width: 1800, height: 2400), for: .mediaBox)
            guard let pageJpeg = rendered.jpegData(compressionQuality: 0.88),
                  let dataUrl = pageDataUrl(rendered) else { continue }
            async let piecesTask = Task.detached(priority: .userInitiated) {
                recognizeFormPiecesJson(from: pageJpeg)
            }.value
            let response = try await send(
                "/v1/forms/fill-image",
                body: ["v": 1, "imageDataUrl": dataUrl, "fileName": "\(fileName)#p\(pageIndex + 1)", "details": cleanDetails],
                account: account,
                userId: userId,
                installationId: installationId,
            )
            let piecesJson = await piecesTask
            allPlanned.append(contentsOf: snapPlannedImageFields(
                response: response,
                imageData: pageJpeg,
                piecesJson: piecesJson,
                page: pageIndex,
            ))
        }
        return allPlanned
    }

    private static func snapPlannedImageFields(
        response: [String: Any],
        imageData: Data,
        piecesJson: String,
        page: Int,
    ) -> [PlannedImageField] {
        guard let rawItems = response["fields"] as? [[String: Any]], !rawItems.isEmpty else {
            return []
        }

        var plannedJsonArray: [[String: Any]] = []
        var items: [PlannedImageField] = []
        for raw in rawItems {
            guard let sourceKey = (raw["sourceKey"] as? String) ?? (raw["key"] as? String),
                  let value = (raw["value"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !value.isEmpty else { continue }
            let box: [Double] = (raw["box"] as? [Double]) ?? ((raw["box"] as? [NSNumber])?.map(\.doubleValue) ?? [])
            guard box.count == 4 else { continue }
            let label = (raw["label"] as? String) ?? ""
            let comb = (raw["comb"] as? Int).flatMap { ($0 >= 2 && $0 <= 64) ? $0 : nil }
            let action = (raw["action"] as? String) ?? "text"
            items.append(PlannedImageField(
                page: page,
                sourceKey: sourceKey,
                label: label,
                value: value,
                x: box[0],
                top: box[1],
                w: box[2],
                h: box[3],
                comb: comb,
                action: action,
            ))
            var jsonObj: [String: Any] = [
                "key": sourceKey,
                "label": label,
                "value": value,
                "box": box,
                "action": action,
            ]
            if let comb { jsonObj["comb"] = comb }
            plannedJsonArray.append(jsonObj)
        }

        if let (luma, w, h) = decodeGrayscaleLuma(from: imageData, maxDimension: 1600),
           let plannedData = try? JSONSerialization.data(withJSONObject: plannedJsonArray),
           let plannedStr = String(data: plannedData, encoding: .utf8),
           let snappedStr = try? captureSnapImageFill(
               luma: luma,
               width: UInt32(w),
               height: UInt32(h),
               piecesJson: piecesJson,
               plannedJson: plannedStr,
               page: UInt32(max(0, page)),
           ),
           let snappedData = snappedStr.data(using: .utf8),
           let snappedArr = (try? JSONSerialization.jsonObject(with: snappedData)) as? [[String: Any]],
           snappedArr.count == items.count {
            items = items.enumerated().map { idx, orig in
                let s = snappedArr[idx]
                let box = (s["box"] as? [Double]) ?? [orig.x, orig.top, orig.w, orig.h]
                let comb = (s["comb"] as? Int) ?? orig.comb
                let action = (s["action"] as? String) ?? orig.action
                return PlannedImageField(
                    page: page,
                    sourceKey: orig.sourceKey,
                    label: orig.label,
                    value: orig.value,
                    x: box[0],
                    top: box[1],
                    w: box[2],
                    h: box[3],
                    comb: comb,
                    action: action,
                )
            }
        }
        return items
    }

    private static func decodeGrayscaleLuma(from data: Data, maxDimension: CGFloat = 1600) -> (Data, Int, Int)? {
        guard let uiImage = UIImage(data: data) else { return nil }
        let rawW = max(1, uiImage.size.width * uiImage.scale)
        let rawH = max(1, uiImage.size.height * uiImage.scale)
        let scale = min(1.0, maxDimension / max(rawW, rawH))
        let w = max(1, Int((rawW * scale).rounded()))
        let h = max(1, Int((rawH * scale).rounded()))
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let upright = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format).image { _ in
            uiImage.draw(in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        guard let cgImage = upright.cgImage else { return nil }
        var pixels = Data(count: w * h)
        let colorSpace = CGColorSpaceCreateDeviceGray()
        let ok = pixels.withUnsafeMutableBytes { ptr -> Bool in
            guard let base = ptr.baseAddress,
                  let ctx = CGContext(
                      data: base,
                      width: w,
                      height: h,
                      bitsPerComponent: 8,
                      bytesPerRow: w,
                      space: colorSpace,
                      bitmapInfo: CGImageAlphaInfo.none.rawValue,
                  ) else { return false }
            ctx.draw(cgImage, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        return ok ? (pixels, w, h) : nil
    }

    private static func fillOfficeFormFile(
        data: Data,
        fileName: String,
        flatDetails: [String: String],
        roleMap: [String: [String: String]],
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> FilledFormOutput {
        var enrichedProfile = flatDetails
        var detectedCount = 0
        if let classifiedJson = try? captureClassifyOffice(bytes: data, fileName: fileName),
           let classifiedData = classifiedJson.data(using: .utf8),
           let classified = (try? JSONSerialization.jsonObject(with: classifiedData)) as? [String: Any],
           let rawFields = classified["fields"] as? [[String: Any]],
           !rawFields.isEmpty {
            detectedCount = rawFields.count
            var inputs: [[String: Any]] = rawFields.enumerated().map { idx, f in
                [
                    "id": (f["id"] as? String) ?? "c_\(idx)",
                    "name": (f["name"] as? String) ?? "",
                    "label": (f["label"] as? String) ?? "",
                    "placeholder": "",
                    "autocomplete": "",
                    "input_type": "text",
                    "section": (f["section"] as? String) ?? "",
                    "form": "",
                    "pattern": "",
                    "max_length": 0,
                    "format": "",
                    "op_ignore": false,
                    "options": [] as [String],
                ]
            }
            let localMatches = runCaptureFillForm(inputs: inputs, roleMap: roleMap, choices: [])
            let unresolved = inputs.indices.filter { i in
                let val = i < localMatches.count ? ((localMatches[i]["value"] as? String) ?? "") : ""
                return val.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
            if !unresolved.isEmpty,
               let choices = try? await describeUnresolvedFields(
                   fileName: fileName,
                   inputs: &inputs,
                   rawFields: rawFields,
                   unresolvedIndices: unresolved,
                   roleMap: roleMap,
                   account: account,
                   userId: userId,
                   installationId: installationId,
               ), !choices.isEmpty {
                let resolvedMatches = runCaptureFillForm(inputs: inputs, roleMap: roleMap, choices: choices)
                for (idx, m) in resolvedMatches.enumerated() where idx < inputs.count {
                    if let val = (m["value"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                       !val.isEmpty,
                       let label = inputs[idx]["label"] as? String,
                       !label.isEmpty,
                       enrichedProfile[label] == nil {
                        enrichedProfile[label] = val
                    }
                }
            }
        }

        let profileData = try JSONSerialization.data(withJSONObject: enrichedProfile)
        guard let profileJson = String(data: profileData, encoding: .utf8) else {
            throw NativeVaultError.invalidInput
        }
        let filledBytes = try captureFillOfficeBytes(bytes: data, fileName: fileName, profileJson: profileJson)
        let ext = (fileName as NSString).pathExtension.lowercased()
        let stem = (fileName as NSString).deletingPathExtension
        let mime = switch ext {
        case "docx":
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        case "xlsx":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        default:
            "application/hwp+zip"
        }
        return FilledFormOutput(
            data: filledBytes,
            fileName: "\(stem) (filled).\(ext)",
            mediaType: mime,
            filledCount: max(1, detectedCount),
        )
    }

    private static func runCaptureFillForm(
        inputs: [[String: Any]],
        roleMap: [String: [String: String]],
        choices: [[String: Any]],
    ) -> [[String: Any]] {
        guard !inputs.isEmpty,
              let fieldsData = try? JSONSerialization.data(withJSONObject: inputs),
              let fieldsJson = String(data: fieldsData, encoding: .utf8),
              let profilesData = try? JSONSerialization.data(withJSONObject: roleMap),
              let profilesJson = String(data: profilesData, encoding: .utf8),
              let choicesData = try? JSONSerialization.data(withJSONObject: choices),
              let choicesJson = String(data: choicesData, encoding: .utf8),
              let outJson = try? captureFillForm(
                  fieldsJson: fieldsJson,
                  profilesJson: profilesJson,
                  choicesJson: choicesJson,
                  explicitFill: true,
              ),
              let outData = outJson.data(using: .utf8),
              let matches = (try? JSONSerialization.jsonObject(with: outData)) as? [[String: Any]] else {
            return []
        }
        return matches
    }

    private static func describeUnresolvedFields(
        fileName: String,
        inputs: inout [[String: Any]],
        rawFields: [[String: Any]],
        unresolvedIndices: [Int],
        roleMap: [String: [String: String]],
        account: Account?,
        userId: String?,
        installationId: String,
    ) async throws -> [[String: Any]] {
        var sectionIds: [String: String] = ["": "main"]
        var sections: [[String: String]] = [["id": "main", "label": fileName]]
        for idx in unresolvedIndices {
            let sec = ((inputs[idx]["section"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !sec.isEmpty, sectionIds[sec] == nil {
                let sid = "sec_\(sections.count)"
                sectionIds[sec] = sid
                sections.append(["id": sid, "label": sec])
            }
        }
        let allFields: [[String: Any]] = unresolvedIndices.map { idx in
            let sec = ((inputs[idx]["section"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let opts = idx < rawFields.count ? ((rawFields[idx]["options"] as? [String]) ?? []) : []
            return [
                "id": "f_\(idx)",
                "sectionId": sectionIds[sec] ?? "main",
                "label": (inputs[idx]["label"] as? String) ?? "field_\(idx)",
                "type": (inputs[idx]["input_type"] as? String) ?? "text",
                "options": Array(opts.prefix(50)),
            ]
        }

        var askFields: [[String: Any]] = []
        let chunkSize = 40
        for start in stride(from: 0, to: allFields.count, by: chunkSize) {
            let chunk = Array(allFields[start..<min(start + chunkSize, allFields.count)])
            let usedSectionIds = Set(chunk.compactMap { $0["sectionId"] as? String })
            let chunkSections = sections.filter { usedSectionIds.contains($0["id"] ?? "") }
            let body: [String: Any] = [
                "v": 1,
                "targetId": "file:\(fileName):\(start)",
                "formSignature": "fill:\(fileName)",
                "sections": chunkSections,
                "fields": chunk,
            ]
            let response = try await send(
                "/v1/forms/describe",
                body: body,
                account: account,
                userId: userId,
                installationId: installationId,
            )
            if let returned = response["fields"] as? [[String: Any]] {
                askFields.append(contentsOf: returned)
            }
        }

        var choices: [[String: Any]] = []
        for ask in askFields {
            guard let askId = ask["id"] as? String,
                  askId.hasPrefix("f_"),
                  let idx = Int(askId.dropFirst(2)),
                  idx >= 0, idx < inputs.count else { continue }
            if let fmt = (ask["format"] as? [String: Any])?["label"] as? String, !fmt.isEmpty {
                let existingFmt = (inputs[idx]["format"] as? String) ?? ""
                if existingFmt.isEmpty { inputs[idx]["format"] = fmt }
            }
            let owner = (ask["owner"] as? String) ?? "applicant"
            let rawAttr = (ask["attribute"] as? String) ?? ""
            let attr: String
            if owner == "official_only" || rawAttr == "none" || rawAttr == "unknown" {
                attr = ""
            } else if owner != "applicant",
                      owner != "employer",
                      roleMap[owner] == nil,
                      !personScopedPrefixes.contains(where: { rawAttr.hasPrefix($0) }) {
                attr = ""
            } else {
                attr = rawAttr
            }
            choices.append([
                "id": (inputs[idx]["id"] as? String) ?? askId,
                "attribute": attr,
                "owner": owner,
            ])
        }
        return choices
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

        if widgets.isEmpty {
            let tempInURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("vk_flat_in_\(UUID().uuidString.lowercased()).pdf")
            let tempOutURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("vk_flat_out_\(UUID().uuidString.lowercased()).pdf")
            defer {
                try? FileManager.default.removeItem(at: tempInURL)
                try? FileManager.default.removeItem(at: tempOutURL)
            }
            try data.write(to: tempInURL, options: .atomic)
            if let formPayload = try? VowkeyDocumentEngine.form(url: tempInURL),
               let rawFields = formPayload["fields"] as? [[String: Any]],
               !rawFields.isEmpty {
                let flatInputs: [[String: Any]] = rawFields.map { f in
                    let key = (f["key"] as? String) ?? ""
                    let label = (f["label"] as? String) ?? key
                    return [
                        "id": key,
                        "name": "",
                        "label": label,
                        "placeholder": "",
                        "autocomplete": "",
                        "input_type": (f["type"] as? String) ?? "text",
                        "section": (f["section"] as? String) ?? "",
                        "format": "",
                        "pattern": "",
                        "max_length": 0,
                        "form": "",
                        "op_ignore": false,
                        "options": (f["options"] as? [String]) ?? [],
                    ]
                }
                let flatVals = fillFieldsLocally(fields: flatInputs, profile: profile)
                var spec: [String: String] = [:]
                for (f, maybeVal) in zip(rawFields, flatVals) {
                    if let key = f["key"] as? String, let v = maybeVal, !v.isEmpty {
                        spec[key] = v
                    }
                }
                if !spec.isEmpty,
                   let count = try? VowkeyDocumentEngine.fill(sourceURL: tempInURL, outURL: tempOutURL, values: spec),
                   let outBytes = try? Data(contentsOf: tempOutURL) {
                    return (outBytes, count)
                }
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
        guard !isOnDeviceOnlyEnabled else {
            throw NativeVaultError.unavailable
        }
        guard let url = URL(string: "https://decision.vowkey.app\(path)") else {
            throw NativeVaultError.unavailable
        }
        let bodyData = try JSONSerialization.data(withJSONObject: body)
        var usedAccountToken = false
        var token = ""
        if let account, userId != nil, let acctToken = try? await account.3.accountTokenProvider.getToken(), !acctToken.isEmpty {
            token = acctToken
            usedAccountToken = true
        } else {
            token = try await guestToken(installationId)
        }
        guard !token.isEmpty else {
            throw NativeVaultError.unavailable
        }

        func performRequest(bearer: String) async throws -> (Data, Int) {
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = 90
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
            request.httpBody = bodyData
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                let status = (response as? HTTPURLResponse)?.statusCode ?? 0
                return (data, status)
            } catch {
                throw NativeVaultError.networkUnavailable
            }
        }

        let isFormEndpoint = path.contains("/forms/")
        var (data, status) = try await performRequest(bearer: token)
        if usedAccountToken, status == 401 || status == 403,
           let fallbackToken = try? await guestToken(installationId), !fallbackToken.isEmpty {
            (data, status) = try await performRequest(bearer: fallbackToken)
        }
        guard (200..<300).contains(status) else {
            throw isFormEndpoint ? NativeVaultError.formServiceUnavailable : NativeVaultError.unavailable
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private static func guestToken(_ installationId: String) async throws -> String {
        guard let url = URL(string: "https://identity.vowkey.app/guest-decision/grant") else {
            throw NativeVaultError.unavailable
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["installationId": installationId])
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await URLSession.shared.data(for: request)
        } catch {
            throw NativeVaultError.networkUnavailable
        }
        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = object["token"] as? String else {
            throw NativeVaultError.unavailable
        }
        return token
    }
}
