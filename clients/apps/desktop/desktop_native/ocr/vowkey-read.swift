// Prints the text of a document: the text layer of a PDF, and what Apple's Vision framework reads
// from an image or from a PDF page that has no text layer, one line per printed line. It also reads
// and fills PDF and photographed paper forms through PDFKit and CoreGraphics.
// Usage:
//   vowkey-read FILE                 the document's text
//   vowkey-read --pieces FILE        the printed pieces of each page as JSON, each with its place on the page
//   vowkey-read --form FILE          the form's fields as JSON, each with the printed words naming it
//   vowkey-read --fill FILE OUT      writes OUT with the values read as JSON {field: value} on stdin
//   vowkey-read --front              the app in front and the file its window shows, as JSON

import AppKit
import ApplicationServices
import CoreImage
import CoreImage.CIFilterBuiltins
import Foundation
import ImageIO
import PDFKit
import Vision

func fail(_ message: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

func normalizeArguments(_ raw: [String]) -> [String] {
    if raw.count >= 3, raw[0] == "--mode" {
        let rest = Array(raw.dropFirst(2))
        switch raw[1] {
        case "places", "form": return ["--form"] + rest
        case "stamp", "fill": return ["--fill"] + rest
        case "pieces": return ["--pieces"] + rest
        default: break
        }
    }
    return raw
}

let arguments = normalizeArguments(Array(CommandLine.arguments.dropFirst()))

/// How the picture being read is turned: a phone saves a photo taken upright with its pixels
/// sideways and says so in the file, and text recognition has to be told.
var imageOrientation = CGImagePropertyOrientation.up

func orientation(of source: CGImageSource) -> CGImagePropertyOrientation {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
        let raw = properties[kCGImagePropertyOrientation] as? UInt32,
        let found = CGImagePropertyOrientation(rawValue: raw)
    else { return .up }
    return found
}

/// The size of a picture as it is shown, turned as its file says.
func shownSize(_ image: CGImage) -> CGSize {
    switch imageOrientation {
    case .left, .right, .leftMirrored, .rightMirrored:
        return CGSize(width: image.height, height: image.width)
    default:
        return CGSize(width: image.width, height: image.height)
    }
}

let usage = "usage: vowkey-read FILE | --pieces FILE | --form FILE | --classify FILE | --fill FILE OUT"

/// Opens a PDF and unlocks empty-password encryption when present; returns nil if still password-locked.
func openPDFDocument(_ url: URL) -> PDFDocument? {
    guard let doc = PDFDocument(url: url) else { return nil }
    if doc.isLocked {
        _ = doc.unlock(withPassword: "")
    }
    return doc.isLocked ? nil : doc
}

/// Clones a PDF whose owner permissions forbid adding annotations (`allowsCommenting == false`) into a
/// clean vector PDF so filled text and circle marks are preserved on disk instead of silently dropped.
func annotatablePDFDocument(_ src: PDFDocument) -> PDFDocument {
    if src.allowsCommenting { return src }
    let mutableData = NSMutableData()
    var defaultBox = CGRect(x: 0, y: 0, width: 595, height: 842)
    guard let consumer = CGDataConsumer(data: mutableData as CFMutableData),
        let pdfCtx = CGContext(consumer: consumer, mediaBox: &defaultBox, nil)
    else { return src }
    for i in 0..<src.pageCount {
        guard let page = src.page(at: i) else { continue }
        var box = page.bounds(for: .mediaBox)
        let pageInfo: [CFString: Any] = [
            kCGPDFContextMediaBox: Data(bytes: &box, count: MemoryLayout<CGRect>.size)
        ]
        pdfCtx.beginPDFPage(pageInfo as CFDictionary)
        page.draw(with: .mediaBox, to: pdfCtx)
        pdfCtx.endPDFPage()
    }
    pdfCtx.closePDF()
    return PDFDocument(data: mutableData as Data) ?? src
}

/// The key a field is filled by: its name, or its place when it has none.
func fieldKey(_ widget: PDFAnnotation, page: Int, index: Int) -> String {
    if let name = widget.fieldName, !name.isEmpty { return name }
    return "p\(page):\(index)"
}

func widgets(_ document: PDFDocument) -> [(page: PDFPage, pageIndex: Int, index: Int, widget: PDFAnnotation)] {
    var found: [(PDFPage, Int, Int, PDFAnnotation)] = []
    for pageIndex in 0..<document.pageCount {
        guard let page = document.page(at: pageIndex) else { continue }
        for (index, annotation) in page.annotations.enumerated()
        where annotation.type == PDFAnnotationSubtype.widget.rawValue.replacingOccurrences(of: "/", with: "") {
            found.append((page, pageIndex, index, annotation))
        }
    }
    return found
}

typealias Line = (box: CGRect, text: String)

/// The printed lines of a page from its text layer, in page coordinates.
func textLayerLines(_ page: PDFPage) -> [Line] {
    guard let all = page.selection(for: page.bounds(for: .mediaBox)) else { return [] }
    return all.selectionsByLine().compactMap { line in
        let text = (line.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : (line.bounds(for: page), text)
    }
}

/// The printed lines of a page as text recognition reads its image, in page coordinates.
func recognizedLines(_ page: PDFPage) -> [Line] {
    let bounds = page.bounds(for: .mediaBox)
    guard let image = pageImage(page) else { return [] }
    // Each piece Vision reads is kept apart: on a form, pieces in one row sit in different cells.
    return recognizePieces(image).map { piece in
        let box = piece.box
        let rect = CGRect(
            x: bounds.minX + box.minX * bounds.width,
            y: bounds.minY + box.minY * bounds.height,
            width: box.width * bounds.width,
            height: box.height * bounds.height)
        return (rect, piece.text)
    }
}

/// The printed line that names a box: the closest one above it or to its left.
func labelNear(_ lines: [Line], _ box: CGRect) -> String {
    let bannerPattern = #"(?:^※|^(?i)(?:part|section|sectie|teil|partie|sección|mục|phần)\b|^[■●◆▶])"#
    let band = max(6, box.height * 0.7)
    var above: (dist: CGFloat, line: Line)?
    var leftAnchor: (dist: CGFloat, line: Line)?
    for line in lines {
        let r = line.box
        if r.minY >= box.maxY - 2, r.minY <= box.maxY + 26, r.maxX >= box.minX - 4, r.minX <= box.maxX + 4 {
            if line.text.range(of: bannerPattern, options: .regularExpression) == nil {
                let d = r.minY - box.maxY
                if above == nil || d < above!.dist { above = (d, line) }
            }
        }
        if abs(r.midY - box.midY) <= band, r.maxX <= box.minX + 4, box.minX - r.maxX <= 220 {
            let d = box.minX - r.maxX
            if leftAnchor == nil || d < leftAnchor!.dist { leftAnchor = (d, line) }
        }
    }
    var leftText: (dist: CGFloat, text: String)? = nil
    if let anchor = leftAnchor {
        // Join tightly stacked lines in the same left label column (e.g. `Name:` + `(Full name as shown in` + `travel document)`).
        let colLines = lines
            .filter { other in
                other.box.maxX <= box.minX + 6
                    && abs(other.box.minX - anchor.line.box.minX) <= 20
                    && abs(other.box.midY - anchor.line.box.midY) <= 34
                    && other.text.range(of: bannerPattern, options: .regularExpression) == nil
            }
            .sorted { $0.box.midY > $1.box.midY }
        if let pivotIdx = colLines.firstIndex(where: { $0.text == anchor.line.text && abs($0.box.midY - anchor.line.box.midY) < 1 }) {
            var lo = pivotIdx
            while lo > 0 {
                let upper = colLines[lo - 1]
                let curr = colLines[lo]
                let vGap = upper.box.minY - curr.box.maxY
                // Stop before a previous separate label that already ends with `:` unless it opens an unclosed `(`.
                let prevEndsColon = upper.text.trimmingCharacters(in: .whitespaces).hasSuffix(":")
                    && !curr.text.trimmingCharacters(in: .whitespaces).hasPrefix("(")
                    && !(curr.text.contains(")") && !curr.text.contains("("))
                if vGap <= 7 && !prevEndsColon {
                    lo -= 1
                } else {
                    break
                }
            }
            var hi = pivotIdx
            while hi + 1 < colLines.count {
                let curr = colLines[hi]
                let lower = colLines[hi + 1]
                let vGap = curr.box.minY - lower.box.maxY
                let nextStartsNewLabel = lower.text.contains(":") && !lower.text.trimmingCharacters(in: .whitespaces).hasPrefix("(")
                if vGap <= 7 && !nextStartsNewLabel {
                    hi += 1
                } else {
                    break
                }
            }
            let joined = colLines[lo...hi].map(\.text).joined(separator: " ")
            leftText = (anchor.dist, joined)
        } else {
            leftText = (anchor.dist, anchor.line.text)
        }
    }
    switch (above, leftText) {
    case let (a?, l?):
        let aboveAligned = abs(a.line.box.minX - box.minX) <= 18 && a.dist < 10
        if aboveAligned && !l.text.contains(":") {
            return a.line.text
        }
        if l.text.contains(":") || l.dist <= 130 {
            return l.text
        }
        return a.dist < l.dist ? a.line.text : l.text
    case let (a?, nil): return a.line.text
    case let (nil, l?): return l.text
    default: return ""
    }
}

struct SubSlot {
    let x: CGFloat
    let w: CGFloat
}

struct ChoiceMark {
    let option: String
    let rect: CGRect
}

struct Piece {
    let text: String
    let box: CGRect
    /// How sure text recognition was of the line the piece is from, 0 to 1.
    var confidence: Float = 1
    /// Pre-split sub-slots when a printed leader line carries `/` or `-` date dividers.
    var leaderSlots: [SubSlot]? = nil
    /// Bounding box of the top primary script line when merged from a 2-line bilingual label.
    var primaryBox: CGRect? = nil
}

/// The text Vision reads from an image, top to bottom, with the pieces that share a line joined.
func recognize(_ image: CGImage) -> [String] {
    rows(recognizePieces(image)).map { $0.sorted(by: { $0.box.minX < $1.box.minX }).map(\.text).joined(separator: " ") }
}

/// A page drawn large enough for text recognition.
func pageImage(_ page: PDFPage) -> CGImage? {
    let bounds = page.bounds(for: .mediaBox)
    let scale = 2200 / max(bounds.width, bounds.height)
    let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
    let thumbnail = page.thumbnail(of: size, for: .mediaBox)
    var rect = CGRect(origin: .zero, size: thumbnail.size)
    return thumbnail.cgImage(forProposedRect: &rect, context: nil, hints: nil)
}

/// A line cut where two words sit a cell apart, so the cells of a row stay separate pieces.
func runs(of text: VNRecognizedText, whole: Piece, image: CGImage) -> [Piece] {
    let string = text.string
    var words: [(range: Range<String.Index>, box: CGRect)] = []
    var i = string.startIndex
    while i < string.endIndex {
        if string[i].isWhitespace {
            i = string.index(after: i)
            continue
        }
        var j = i
        while j < string.endIndex, !string[j].isWhitespace { j = string.index(after: j) }
        guard let found = try? text.boundingBox(for: i..<j) else { return [whole] }
        words.append((i..<j, found.boundingBox))
        i = j
    }
    guard words.count > 1 else { return [whole] }
    let width = shownSize(image).width
    let height = shownSize(image).height
    var pieces: [Piece] = []
    var start = 0
    func close(_ end: Int) {
        let box = words[start...end].reduce(CGRect.null) { $0.union($1.box) }
        let value = String(string[words[start].range.lowerBound..<words[end].range.upperBound])
        pieces.append(Piece(text: value, box: box, confidence: whole.confidence))
    }
    for k in 1..<words.count {
        let gap = max(words[k].box.minX - words[k - 1].box.maxX, words[k - 1].box.minX - words[k].box.maxX) * width
        let line = max(words[k - 1].box.height, words[k].box.height) * height
        if gap > 0.75 * line {
            close(k - 1)
            start = k
        }
    }
    close(words.count - 1)
    return pieces
}

/// Whether a raw OCR line is a machine-readable zone line (TD1/TD2/TD3) whose characters and check
/// digits must not be altered by dictionary correction.
func isMrzCandidateText(_ raw: String) -> Bool {
    let compact = raw.filter { !$0.isWhitespace }
    guard compact.count >= 20 else { return false }
    if compact.contains(where: { $0.isLowercase }) { return false }
    let validCount = compact.filter {
        ($0 >= "A" && $0 <= "Z") || ($0 >= "0" && $0 <= "9") || $0 == "<"
    }.count
    guard Double(validCount) / Double(compact.count) >= 0.88 else { return false }
    if compact.contains("<<") { return true }
    let chevrons = compact.filter { $0 == "<" }.count
    let digits = compact.filter { $0 >= "0" && $0 <= "9" }.count
    return compact.count >= 26 && (chevrons >= 1 && digits >= 6 || digits >= 10 && validCount == compact.count)
}

/// Harvests only machine-readable zone lines without language correction so check digits stay exact.
func harvestMrzPieces(_ image: CGImage) -> [Piece] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = false
    request.automaticallyDetectsLanguage = false
    if let supported = try? request.supportedRecognitionLanguages(), supported.contains("en-US") {
        request.recognitionLanguages = ["en-US"]
    }
    guard (try? VNImageRequestHandler(cgImage: image, orientation: imageOrientation, options: [:]).perform([request])) != nil
    else { return [] }
    let observations = request.results ?? []
    var anchors: [CGRect] = []
    var candidates: [(piece: Piece, hasDoubleChevron: Bool, pureMrzCharset: Bool)] = []
    for obs in observations {
        guard let top = obs.topCandidates(1).first else { continue }
        let compact = top.string.filter { !$0.isWhitespace }
        guard compact.count >= 20 else { continue }
        let validCount = compact.filter {
            ($0 >= "A" && $0 <= "Z") || ($0 >= "0" && $0 <= "9") || $0 == "<"
        }.count
        let pureCharset = !compact.contains(where: { $0.isLowercase }) && Double(validCount) / Double(compact.count) >= 0.90
        let hasDouble = compact.contains("<<") && pureCharset
        if hasDouble {
            anchors.append(obs.boundingBox)
        }
        if pureCharset {
            candidates.append((Piece(text: compact, box: obs.boundingBox, confidence: top.confidence), hasDouble, pureCharset))
        }
    }
    guard !anchors.isEmpty || candidates.contains(where: { isMrzCandidateText($0.piece.text) }) else {
        return []
    }
    let matched: [Piece] = candidates.compactMap { item in
        if item.hasDoubleChevron || isMrzCandidateText(item.piece.text) {
            return item.piece
        }
        // Keep an adjacent TD1/TD2/TD3 numeric line right above or below an `<<` anchor line.
        let b = item.piece.box
        let nearAnchor = anchors.contains { a in
            abs(a.midY - b.midY) <= max(a.height, b.height) * 2.8
                && abs(a.minX - b.minX) <= 0.08
                && b.width >= 0.45
        }
        return (nearAnchor && item.piece.text.count >= 26) ? item.piece : nil
    }
    // Vision often clips trailing `<` filler at the right margin when an MRZ line ends in `<`
    // without a trailing check digit. Restore the standard ICAO 9303 line length from its companion
    // MRZ line (30, 36, or 44) or unambiguous TD3 `P<` prefix (> 36 chars).
    return matched.map { piece in
        guard piece.text.hasSuffix("<") else { return piece }
        let companion = matched.first { other in
            other.text != piece.text
                && [30, 36, 44].contains(other.text.count)
                && abs(other.box.minX - piece.box.minX) <= 0.08
                && abs(other.box.midY - piece.box.midY) <= max(other.box.height, piece.box.height) * 4.5
        }
        let targetLen: Int?
        if let companion, piece.text.count < companion.text.count, piece.text.count >= companion.text.count - 18 {
            targetLen = companion.text.count
        } else if piece.text.hasPrefix("P<") && piece.text.contains("<<") && (37...43).contains(piece.text.count) {
            targetLen = 44
        } else {
            targetLen = nil
        }
        guard let targetLen, piece.text.count < targetLen else { return piece }
        let padded = piece.text + String(repeating: "<", count: targetLen - piece.text.count)
        var box = piece.box
        if let companion {
            box.size.width = max(box.width, companion.box.maxX - box.minX)
        } else {
            let scaledWidth = box.width * CGFloat(targetLen) / CGFloat(piece.text.count)
            box.size.width = min(1.0 - box.minX, max(box.width, scaledWidth))
        }
        return Piece(text: padded, box: box, confidence: piece.confidence)
    }
}

/// Replaces any primary language-corrected piece overlapping a raw MRZ line with the raw MRZ reading.
func mergeMrzPieces(primary: [Piece], mrz: [Piece]) -> [Piece] {
    guard !mrz.isEmpty else { return primary }
    var kept = primary.filter { p in
        for m in mrz {
            let yOverlap = min(p.box.maxY, m.box.maxY) - max(p.box.minY, m.box.minY)
            let minH = max(0.001, min(p.box.height, m.box.height))
            let xOverlap = min(p.box.maxX, m.box.maxX) - max(p.box.minX, m.box.minX)
            let minW = max(0.001, min(p.box.width, m.box.width))
            if yOverlap / minH > 0.45 && (xOverlap / minW > 0.35 || m.box.width > 0.50) {
                return false
            }
        }
        return true
    }
    kept.append(contentsOf: mrz)
    return kept
}

/// Whether a Unicode scalar is a genuine CJK character rather than a geometric chevron/dot lookalike (`く`, `・`, `ー`).
func isDistinctiveCjkScalar(_ scalar: UInt32) -> Bool {
    if scalar == 0x304F || scalar == 0x30FB || scalar == 0x30FC { return false }
    return (0x3041...0x3096).contains(scalar)
        || (0x30A1...0x30FA).contains(scalar)
        || (0x3400...0x9FFF).contains(scalar)
        || (0xAC00...0xD7AF).contains(scalar)
}

/// One reading of a picture: the pieces and how sure the model was of them.
func recognizeScale(_ image: CGImage, split: Bool) -> (score: Float, pieces: [Piece]) {
    // Vision reads with the model of the first language it is given: Latin text through a
    // Japanese model comes out fine, but Japanese, Chinese or Korean through a Latin model comes out
    // as noise. Auto-detected language plus each script's model reads the page with language
    // correction enabled, and a lightweight raw pass preserves MRZ lines verbatim.
    let latin = [
        "en-US", "vi-VT", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "id-ID", "tr-TR", "pl-PL",
        "nl-NL", "ru-RU", "uk-UA", "th-TH",
    ]
    let passes: [[String]?] = [nil, latin, ["ja-JP", "en-US"], ["zh-Hans", "zh-Hant", "en-US"], ["ko-KR", "en-US"]]
    var best: (score: Float, pieces: [Piece]) = (-1, [])
    for languages in passes {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.minimumTextHeight = 0.012
        if let languages {
            request.automaticallyDetectsLanguage = false
            if let supported = try? request.supportedRecognitionLanguages() {
                let usable = languages.filter { supported.contains($0) }
                if usable.isEmpty { continue }
                request.recognitionLanguages = usable
            }
        } else {
            request.automaticallyDetectsLanguage = true
        }
        do {
            try VNImageRequestHandler(cgImage: image, orientation: imageOrientation, options: [:]).perform([request])
        } catch {
            fail("text recognition failed: \(error)")
        }
        let observations = request.results ?? []
        var realCjkCount = 0
        var totalAlphaNum = 0
        for observation in observations {
            guard let top = observation.topCandidates(1).first else { continue }
            for ch in top.string where ch.isLetter || ch.isNumber {
                totalAlphaNum += 1
                let scalar = ch.unicodeScalars.first?.value ?? 0
                if isDistinctiveCjkScalar(scalar) {
                    realCjkCount += 1
                }
            }
        }
        let hasSubstantialCjk = realCjkCount >= 6 && Double(realCjkCount) / Double(max(1, totalAlphaNum)) >= 0.05
        var score: Float = 0
        let pieces: [Piece] = observations.flatMap { observation -> [Piece] in
            guard let top = observation.topCandidates(1).first else { return [] }
            let noiseCount = top.string.filter { "#*÷•=+][".contains($0) }.count
            let weight: Float = top.string.reduce(0) { sum, ch in
                guard ch.isLetter || ch.isNumber else { return sum }
                let scalar = ch.unicodeScalars.first?.value ?? 0
                let isCjk = (0x3040...0x30FF).contains(scalar)
                    || (0x3400...0x9FFF).contains(scalar)
                    || (0xAC00...0xD7AF).contains(scalar)
                if isCjk {
                    return sum + (hasSubstantialCjk ? 3.2 : 0.5)
                }
                return sum + 1.0
            }
            score += top.confidence * max(0, weight - Float(noiseCount) * 4.0)
            let whole = Piece(text: top.string, box: observation.boundingBox, confidence: top.confidence)
            return split ? runs(of: top, whole: whole, image: image) : [whole]
        }
        if score > best.score { best = (score, pieces) }
    }
    let mrz = harvestMrzPieces(image)
    if !mrz.isEmpty {
        best.pieces = mergeMrzPieces(primary: best.pieces, mrz: mrz)
    }
    return best
}

/// A picture drawn larger, where small print is easier for text recognition.
func upscaled(_ image: CGImage, by factor: CGFloat) -> CGImage? {
    let width = Int(CGFloat(image.width) * factor)
    let height = Int(CGFloat(image.height) * factor)
    guard
        let context = CGContext(
            data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return nil }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    return context.makeImage()
}

/// Drops handwritten cursive ink signatures located directly below a portrait face column on photo IDs.
func filterPortraitSignatures(_ pieces: [Piece], in image: CGImage) -> [Piece] {
    guard pieces.count >= 6 else { return pieces }
    let faceReq = VNDetectFaceRectanglesRequest()
    guard (try? VNImageRequestHandler(cgImage: image, orientation: imageOrientation, options: [:]).perform([faceReq])) != nil,
        let faces = faceReq.results,
        let portrait = faces
            .filter({ $0.boundingBox.width >= 0.10 && $0.boundingBox.height >= 0.14 })
            .max(by: { $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height })
    else { return pieces }

    let fb = portrait.boundingBox
    let heights = pieces.map(\.box.height).sorted()
    let medianH = heights[heights.count / 2]
    guard medianH > 0 else { return pieces }
    // Ensure a distinct printed data column sits to the right of the portrait column.
    let rightColCount = pieces.filter { $0.box.minX >= fb.maxX - 0.02 }.count
    guard Double(rightColCount) / Double(pieces.count) >= 0.55 else { return pieces }

    return pieces.filter { p in
        // Vision bottom-up coordinates: below portrait means `p.box.maxY < fb.minY + 0.04`.
        let belowPortrait = p.box.maxY <= fb.minY + 0.04
        let inPortraitCol = p.box.minX >= max(0, fb.minX - 0.08) && p.box.maxX <= fb.maxX + 0.06
        let tallCursiveLoop = p.box.height >= medianH * 1.50
        let hasDigitsOrColon = p.text.contains(where: \.isNumber) || p.text.contains(":") || p.text.contains("：")
        if belowPortrait && inPortraitCol && tallCursiveLoop && !hasDigitsOrColon {
            return false
        }
        return true
    }
}

/// A picture read at its own size and, when it is small, again enlarged; the reading that the model
/// is surer of is kept.
func recognizeBest(_ image: CGImage, split: Bool) -> (score: Float, pieces: [Piece]) {
    var best = recognizeScale(image, split: split)
    let minDim = min(image.width, image.height)
    if minDim < 1100 {
        let factor = min(3.0, max(2.0, ceil(1200.0 / CGFloat(max(1, minDim)))))
        if let larger = upscaled(image, by: factor) {
            let again = recognizeScale(larger, split: split)
            if again.score > best.score { best = again }
        }
    }
    best.pieces = filterPortraitSignatures(best.pieces, in: image)
    return best
}

/// The pieces of text Vision reads from a page, each with its box in normalized image coordinates.
/// With `split`, a line that crosses cells comes back as one piece for each cell.
func recognizePieces(_ image: CGImage, split: Bool = false) -> [Piece] {
    recognizeBest(image, split: split).pieces
}

func isConvexQuad(_ corners: [CGPoint]) -> Bool {
    guard corners.count == 4 else { return false }
    var sign: CGFloat = 0
    for i in 0..<4 {
        let a = corners[i]
        let b = corners[(i + 1) % 4]
        let c = corners[(i + 2) % 4]
        let cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)
        if abs(cross) < 1e-4 { return false }
        if sign == 0 {
            sign = cross
        } else if (cross > 0) != (sign > 0) {
            return false
        }
    }
    return true
}

/// The page of a photo straightened: found as the document in the picture and drawn square on, so a
/// handheld card or tilted form reads in straight rows. Nil when no valid document quad is found.
func rectified(_ image: CGImage, skipNearFullFrame: Bool = false) -> CGImage? {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: imageOrientation, options: [:])
    guard (try? handler.perform([request])) != nil, let found = request.results?.first, found.confidence >= 0.5
    else { return nil }
    let corners = [found.topLeft, found.topRight, found.bottomRight, found.bottomLeft]
    guard isConvexQuad(corners) else { return nil }
    let area = abs(
        zip(corners, corners.dropFirst() + [corners[0]]).reduce(CGFloat(0)) { $0 + $1.0.x * $1.1.y - $1.1.x * $1.0.y }) / 2
    guard area > 0.05 else { return nil }
    if skipNearFullFrame && area > 0.96 {
        let targets = [CGPoint(x: 0, y: 1), CGPoint(x: 1, y: 1), CGPoint(x: 1, y: 0), CGPoint(x: 0, y: 0)]
        let alreadySquare = zip(corners, targets).allSatisfy { hypot($0.0.x - $0.1.x, $0.0.y - $0.1.y) <= 0.03 }
        if alreadySquare { return nil }
    }
    var oriented = CIImage(cgImage: image).oriented(imageOrientation)
    oriented = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
    let size = oriented.extent.size
    func point(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * size.width, y: p.y * size.height) }
    let tl = point(found.topLeft)
    let tr = point(found.topRight)
    let br = point(found.bottomRight)
    let bl = point(found.bottomLeft)
    let avgW = (hypot(tr.x - tl.x, tr.y - tl.y) + hypot(br.x - bl.x, br.y - bl.y)) * 0.5
    let avgH = (hypot(tl.x - bl.x, tl.y - bl.y) + hypot(tr.x - br.x, tr.y - br.y)) * 0.5
    guard min(avgW, avgH) >= 60, max(avgW, avgH) / max(1, min(avgW, avgH)) <= 4.5 else { return nil }
    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = oriented
    filter.topLeft = tl
    filter.topRight = tr
    filter.bottomLeft = bl
    filter.bottomRight = br
    guard let output = filter.outputImage else { return nil }
    return CIContext().createCGImage(output, from: output.extent)
}

/// Deskews a photographed paper form when tilted or framed on a background, preserving already-flat scans.
func deskewFormImage(_ uprightImage: CGImage) -> CGImage {
    let saved = imageOrientation
    imageOrientation = .up
    defer { imageOrientation = saved }
    return rectified(uprightImage, skipNearFullFrame: true) ?? uprightImage
}

/// A photo read as it is and again straightened, and the reading the model is surer of is kept,
/// with the shape of the page it was read from and its height in pixels.
func recognizePhoto(_ image: CGImage, split: Bool) -> (pieces: [Piece], aspect: CGFloat, height: CGFloat) {
    let original = imageOrientation
    let first = recognizeBest(image, split: split)
    var best = (
        score: first.score, pieces: first.pieces, aspect: shownSize(image).width / shownSize(image).height,
        height: shownSize(image).height
    )
    if let flat = rectified(image) {
        imageOrientation = .up
        let again = recognizeBest(flat, split: split)
        let size = shownSize(flat)
        imageOrientation = original
        // Prefer the rectified crop whenever it scores higher or within 5% of the unrectified frame
        // (unrectified frames can pick up stray background edges while tilted card rows distort boxes).
        if again.score >= best.score * 0.95 && !again.pieces.isEmpty {
            best = (again.score, again.pieces, size.width / size.height, size.height)
        }
    }
    imageOrientation = original
    return (best.pieces, best.aspect, best.height)
}

/// How well a picture read: the share of its printed characters that text recognition was unsure
/// of, its median line height in pixels, and a boundary `diagnostic` when unreadable or too small.
func legibility(_ pieces: [Piece], height: CGFloat?, reportEmptyAsUnreadable: Bool = false) -> [String: Any] {
    let characters = pieces.reduce(0) { $0 + $1.text.filter { !$0.isWhitespace }.count }
    guard characters > 0 else {
        return reportEmptyAsUnreadable ? ["unsure": 1.0, "diagnostic": "unreadable"] : [:]
    }
    let unsure = pieces.filter { $0.confidence < 0.5 }.reduce(0) { $0 + $1.text.filter { !$0.isWhitespace }.count }
    let unsureRatio = Double(unsure) / Double(characters)
    var found: [String: Any] = ["unsure": unsureRatio]
    var lineHeightPx: Double? = nil
    if let height {
        let meaningful = pieces.filter { $0.text.contains(where: { ch in ch.isLetter || ch.isNumber }) }
        let sample = meaningful.isEmpty ? pieces : meaningful
        let lines = sample.map { $0.box.height }.sorted()
        let lh = Double(lines[lines.count / 2] * height)
        lineHeightPx = lh
        found["lineHeight"] = lh
    }
    if let lh = lineHeightPx, lh < 7.0 {
        found["diagnostic"] = "too_small"
    } else if unsureRatio >= 0.5 {
        if let lh = lineHeightPx, lh < 10.0 {
            found["diagnostic"] = "too_small"
        } else {
            found["diagnostic"] = "unreadable"
        }
    }
    return found
}

/// Pieces that share a printed line, top to bottom. Vision's origin is the bottom left.
func rows(_ pieces: [Piece]) -> [[Piece]] {
    var rows: [[Piece]] = []
    for piece in pieces.sorted(by: { $0.box.midY > $1.box.midY }) {
        if let last = rows.indices.last,
            let anchor = rows[last].first,
            abs(anchor.box.midY - piece.box.midY) < max(anchor.box.height, piece.box.height) * 0.5
        {
            rows[last].append(piece)
        } else {
            rows.append([piece])
        }
    }
    return rows
}

/// Applies EXIF orientation so pixel coordinates and Vision's upright reading share one frame.
func orientedCGImage(_ image: CGImage, _ orient: CGImagePropertyOrientation) -> CGImage {
    guard orient != .up else { return image }
    var ci = CIImage(cgImage: image).oriented(orient)
    ci = ci.transformed(by: CGAffineTransform(translationX: -ci.extent.minX, y: -ci.extent.minY))
    return CIContext().createCGImage(ci, from: ci.extent) ?? image
}

struct GrayBitmap {
    let width: Int
    let height: Int
    let pixels: [UInt8]

    init?(_ image: CGImage) {
        let w = min(image.width, 1600)
        let h = min(image.height, 2200)
        var buf = [UInt8](repeating: 255, count: w * h)
        guard let ctx = CGContext(
            data: &buf,
            width: w,
            height: h,
            bitsPerComponent: 8,
            bytesPerRow: w,
            space: CGColorSpaceCreateDeviceGray(),
            bitmapInfo: CGImageAlphaInfo.none.rawValue
        ) else { return nil }
        ctx.interpolationQuality = .medium
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        self.width = w
        self.height = h
        self.pixels = buf
    }

    func lum(_ x: CGFloat, _ y: CGFloat) -> Int {
        let px = max(0, min(width - 1, Int(x * CGFloat(width - 1))))
        let py = max(0, min(height - 1, Int((1.0 - y) * CGFloat(height - 1))))
        return Int(pixels[py * width + px])
    }

    /// Finds all vertical cell border lines to the right of a label on the same row, ignoring
    /// vertical strokes inside printed text/unit tokens on that row.
    func verticalWalls(
        from startX: CGFloat,
        to endX: CGFloat,
        midY: CGFloat,
        rowH: CGFloat,
        ignoring: [CGRect] = []
    ) -> [CGFloat] {
        guard endX > startX + 0.01 else { return [] }
        let x0 = max(0, Int(startX * CGFloat(width)))
        let x1 = min(width - 2, Int(endX * CGFloat(width)))
        guard x1 > x0 else { return [] }
        let halfSpan = max(rowH * 0.48, 0.009)
        let yTop = min(0.98, midY + halfSpan)
        let yBot = max(0.02, midY - halfSpan)
        let samples = 9
        var walls: [CGFloat] = []
        var px = x0
        while px <= x1 {
            let xNorm = CGFloat(px) / CGFloat(width)
            if ignoring.contains(where: { xNorm >= $0.minX - 0.004 && xNorm <= $0.maxX + 0.004 }) {
                px += 1
                continue
            }
            let bg = max(lum(max(0, xNorm - 0.008), midY), lum(min(1, xNorm + 0.008), midY))
            var darkCount = 0
            for s in 0..<samples {
                let y = yBot + (yTop - yBot) * CGFloat(s) / CGFloat(samples - 1)
                let v = min(lum(xNorm, y), min(lum(xNorm - 0.001, y), lum(xNorm + 0.001, y)))
                if v < bg - 15 {
                    darkCount += 1
                }
            }
            if darkCount >= samples - 2 {
                if let last = walls.last, xNorm - last < 0.0045 {
                    px += 1
                    continue
                }
                walls.append(xNorm)
                px += max(2, Int(0.004 * CGFloat(width)))
            } else {
                px += 1
            }
        }
        return walls
    }

    /// Detects a structural comb grid of `>= 4` adjacent equal-width character cells from vertical walls.
    func detectCombGrid(
        walls: [CGFloat],
        midY: CGFloat,
        rowH: CGFloat
    ) -> (startX: CGFloat, endX: CGFloat, minY: CGFloat, height: CGFloat, cells: Int)? {
        guard walls.count >= 5 else { return nil }
        let diffs = zip(walls, walls.dropFirst()).map { $1 - $0 }
        var bestRange: Range<Int>? = nil
        for i in 0..<diffs.count {
            guard diffs[i] >= 0.013, diffs[i] <= 0.058 else { continue }
            var j = i
            while j < diffs.count, diffs[j] >= 0.013, diffs[j] <= 0.058 {
                let slice = Array(diffs[i...j]).sorted()
                let med = slice[slice.count / 2]
                let tol = max(0.0045, med * 0.22)
                if slice.allSatisfy({ abs($0 - med) <= tol }) {
                    j += 1
                } else {
                    break
                }
            }
            let len = j - i
            if len >= 4, bestRange == nil || len > bestRange!.count {
                bestRange = i..<j
            }
        }
        guard let r = bestRange else { return nil }
        let startX = walls[r.lowerBound]
        let endX = walls[r.upperBound]
        let cells = r.count

        // Snap vertical bounds to the comb's top and bottom horizontal border lines when present.
        var minY = midY - max(rowH * 0.65, 0.011)
        var maxY = midY + max(rowH * 0.65, 0.011)
        let sampleXs = (0..<min(cells, 6)).map { k in
            startX + (endX - startX) * (CGFloat(k) + 0.5) / CGFloat(cells)
        }
        let bg = sampleXs.map { lum($0, midY) }.max() ?? 245
        for dy in stride(from: rowH * 0.30, through: rowH * 1.15, by: 0.0015) {
            let yUp = min(0.99, midY + dy)
            let darkUp = sampleXs.filter { lum($0, yUp) < bg - 22 }.count
            if darkUp >= max(2, sampleXs.count - 1) {
                maxY = yUp
                break
            }
        }
        for dy in stride(from: rowH * 0.30, through: rowH * 1.15, by: 0.0015) {
            let yDn = max(0.01, midY - dy)
            let darkDn = sampleXs.filter { lum($0, yDn) < bg - 22 }.count
            if darkDn >= max(2, sampleXs.count - 1) {
                minY = yDn
                break
            }
        }
        return (startX, endX, minY, max(0.018, maxY - minY), cells)
    }

    /// Detects 2 printed `/` or `-` sub-delimiters in the upper cap band of a fill span (above
    /// baseline leader dots and underlines), returning the 3 sub-slots around them.
    func detectSlashSubSlots(from startX: CGFloat, to endX: CGFloat, labelBox: CGRect) -> [SubSlot]? {
        let spanW = endX - startX
        guard spanW >= 0.16 else { return nil }
        let x0 = max(0, Int((startX + 0.006) * CGFloat(width)))
        let x1 = min(width - 1, Int((endX - 0.006) * CGFloat(width)))
        guard x1 - x0 >= 40 else { return nil }

        // Scan the upper cap band [midY + 0.06*h .. maxY - 0.04*h], which sits cleanly above
        // dotted leaders and underlines while intersecting `/` slashes.
        let yLow = min(0.98, labelBox.midY + labelBox.height * 0.06)
        let yHigh = min(0.99, labelBox.maxY - labelBox.height * 0.04)
        guard yHigh > yLow + 0.003 else { return nil }
        let pyTop = max(0, min(height - 1, Int((1.0 - yHigh) * CGFloat(height - 1))))
        let pyBot = max(0, min(height - 1, Int((1.0 - yLow) * CGFloat(height - 1))))
        guard pyBot >= pyTop + 3 else { return nil }

        var samples: [Int] = []
        for px in stride(from: x0, through: x1, by: max(1, (x1 - x0) / 30)) {
            samples.append(Int(pixels[((pyTop + pyBot) / 2) * width + px]))
        }
        samples.sort()
        let bg = samples.isEmpty ? 245 : samples[Int(Double(samples.count - 1) * 0.85)]

        var validRows = 0
        var colHits = [Int](repeating: 0, count: x1 - x0 + 1)
        for py in pyTop...pyBot {
            var rowDark = 0
            for px in x0...x1 where Int(pixels[py * width + px]) < bg - 35 {
                rowDark += 1
            }
            // Reject rows that hit a horizontal line or dense printed text.
            if Double(rowDark) / Double(x1 - x0 + 1) > 0.08 { continue }
            validRows += 1
            for px in x0...x1 where Int(pixels[py * width + px]) < bg - 35 {
                colHits[px - x0] += 1
            }
        }
        guard validRows >= 4 else { return nil }

        var clusters: [(minX: CGFloat, maxX: CGFloat)] = []
        let gapTol = max(3, Int(0.004 * CGFloat(width)))
        var lastPx = -1000
        var curStart = 0
        for i in 0..<colHits.count where colHits[i] >= 1 {
            let px = x0 + i
            if px - lastPx > gapTol {
                if lastPx >= 0 {
                    clusters.append((CGFloat(curStart) / CGFloat(width), CGFloat(lastPx) / CGFloat(width)))
                }
                curStart = px
            }
            lastPx = px
        }
        if lastPx >= 0 {
            clusters.append((CGFloat(curStart) / CGFloat(width), CGFloat(lastPx) / CGFloat(width)))
        }
        guard clusters.count == 2 else { return nil }
        for c in clusters {
            let cw = c.maxX - c.minX
            if cw > 0.016 { return nil }
        }
        let pad: CGFloat = 0.005
        let s1 = SubSlot(x: startX, w: clusters[0].minX - pad - startX)
        let s2 = SubSlot(x: clusters[0].maxX + pad, w: clusters[1].minX - pad - (clusters[0].maxX + pad))
        let s3 = SubSlot(x: clusters[1].maxX + pad, w: endX - (clusters[1].maxX + pad))
        guard s1.w >= 0.035, s2.w >= 0.035, s3.w >= 0.045 else { return nil }
        return [s1, s2, s3]
    }

    func hasHorizontalRule(from x0Norm: CGFloat, to x1Norm: CGFloat, yLow: CGFloat, yHigh: CGFloat) -> CGFloat? {
        guard x1Norm - x0Norm >= 0.06, yHigh > yLow else { return nil }
        let px0 = max(0, min(width - 1, Int(x0Norm * CGFloat(width - 1))))
        let px1 = max(0, min(width - 1, Int(x1Norm * CGFloat(width - 1))))
        guard px1 - px0 >= 16 else { return nil }
        let pyTop = max(0, min(height - 1, Int((1.0 - yHigh) * CGFloat(height - 1))))
        let pyBot = max(0, min(height - 1, Int((1.0 - yLow) * CGFloat(height - 1))))
        guard pyBot >= pyTop else { return nil }
        var bgSamples: [Int] = []
        let bgYAbove = min(0.99, yHigh + 0.006)
        let bgYBelow = max(0.01, yLow - 0.006)
        for k in 0...8 {
            let sx = x0Norm + (x1Norm - x0Norm) * CGFloat(k) / 8.0
            bgSamples.append(lum(sx, bgYAbove))
            bgSamples.append(lum(sx, bgYBelow))
        }
        bgSamples.sort()
        let bg = bgSamples.isEmpty ? 245 : max(215, bgSamples[Int(Double(bgSamples.count - 1) * 0.85)])
        for py in pyTop...pyBot {
            var hits = 0
            var total = 0
            let pyUp = max(0, py - 1)
            let pyDn = min(height - 1, py + 1)
            for px in stride(from: px0, through: px1, by: 2) {
                total += 1
                let v = min(
                    Int(pixels[py * width + px]),
                    min(Int(pixels[pyUp * width + px]), Int(pixels[pyDn * width + px]))
                )
                if v < bg - 16 {
                    hits += 1
                }
            }
            if total > 0, Double(hits) / Double(total) >= 0.78 {
                return 1.0 - CGFloat(py) / CGFloat(max(1, height - 1))
            }
        }
        return nil
    }

    /// Detects when a short caption (e.g. `Family name`, `Given name`) is printed directly underneath a
    /// horizontal writing line with open space above the line, returning the writing slot above the line.
    func overlinedWritingSlot(for labelBox: CGRect, labelText: String, rightBound: CGFloat, pieces: [Piece]) -> CGRect? {
        guard labelBox.height <= 0.020, labelBox.width <= 0.20 else { return nil }
        let trimmed = labelText.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasSuffix(":") || trimmed.hasSuffix("：") { return nil }
        if trimmed.range(of: #"^(?:[0-9]{1,2}[\.\)\]]|\([0-9a-zA-Z]{1,2}\)|\[[0-9]{1,2}\])"#, options: .regularExpression) != nil {
            return nil
        }
        let spanEnd = min(rightBound, max(labelBox.maxX + 0.05, labelBox.minX + 0.12))
        guard rightBound - labelBox.minX >= 0.09 else { return nil }
        guard let lineY = hasHorizontalRule(
            from: labelBox.minX,
            to: spanEnd,
            yLow: labelBox.maxY - 0.001,
            yHigh: labelBox.maxY + 0.009
        ) else { return nil }
        // Reject boxed table cells that also have a bottom horizontal border right below the label.
        if hasHorizontalRule(
            from: labelBox.minX,
            to: spanEnd,
            yLow: max(0.01, labelBox.minY - 0.009),
            yHigh: labelBox.minY + 0.001
        ) != nil {
            return nil
        }
        let slotH: CGFloat = 0.022
        let bg = max(lum(labelBox.minX, min(0.99, lineY + 0.012)), 215)
        var ruleEndX = spanEnd
        var whiteRun: CGFloat = 0
        var scanX = spanEnd
        while scanX <= rightBound {
            let v = min(lum(scanX, lineY), min(lum(scanX, lineY + 0.001), lum(scanX, lineY - 0.001)))
            if v < bg - 25 {
                ruleEndX = scanX
                whiteRun = 0
            } else {
                whiteRun += 0.002
                if whiteRun >= 0.014 { break }
            }
            scanX += 0.002
        }
        let slotW = max(spanEnd, ruleEndX) - labelBox.minX
        guard slotW >= 0.08 else { return nil }
        let candidate = CGRect(
            x: labelBox.minX,
            y: lineY + 0.002,
            width: slotW,
            height: slotH
        )
        // Reject when the region above the line belongs to a comb or multi-cell row (e.g. an ID grid above).
        let aboveWalls = verticalWalls(
            from: candidate.minX,
            to: candidate.maxX,
            midY: candidate.midY,
            rowH: candidate.height * 0.85,
            ignoring: []
        )
        if aboveWalls.count >= 3 { return nil }
        let checkRect = candidate.insetBy(dx: 0.004, dy: 0.002)
        guard pieces.allSatisfy({ !$0.box.intersects(checkRect) }) else { return nil }
        return candidate
    }

    /// Detects a separated 3-part date comb (`DD  MM  YYYY` or `YYYY  MM  DD`) from vertical cell walls.
    func detectDateBoxTrio(
        walls: [CGFloat],
        midY: CGFloat,
        rowH: CGFloat
    ) -> (rect: CGRect, slots: [SubSlot])? {
        guard walls.count >= 8 else { return nil }
        let diffs = zip(walls, walls.dropFirst()).map { $1 - $0 }
        // Distinguish real bordered cells from open inter-group gaps by checking for top/bottom box strokes.
        func intervalIsBoxed(_ idx: Int) -> Bool {
            let xMid = (walls[idx] + walls[idx + 1]) * 0.5
            let bg = max(215, lum(xMid, midY))
            var hasTop = false
            var hasBot = false
            for dy in stride(from: rowH * 0.28, through: max(rowH * 1.15, 0.022), by: 0.0015) {
                if lum(xMid, min(0.99, midY + dy)) < bg - 15 { hasTop = true }
                if lum(xMid, max(0.01, midY - dy)) < bg - 15 { hasBot = true }
            }
            return hasTop && hasBot
        }
        var rawGroups: [(startIdx: Int, endIdx: Int, cells: Int, width: CGFloat)] = []
        var i = 0
        while i < diffs.count {
            if diffs[i] >= 0.013 && diffs[i] <= 0.042 && intervalIsBoxed(i) {
                let s = i
                let ref = diffs[i]
                var e = i + 1
                while e < diffs.count,
                    abs(diffs[e] - ref) <= max(0.0045, ref * 0.24),
                    intervalIsBoxed(e)
                {
                    e += 1
                }
                rawGroups.append((s, e, e - s, walls[e] - walls[s]))
                i = e
            } else {
                i += 1
            }
        }
        // Merge separated single-digit squares (`[ ] [ ]   [ ] [ ]   [ ] [ ] [ ] [ ]`) whose intra-unit
        // spacing (`<= 0.010`) is noticeably tighter than the inter-unit spacing (`DD` | `MM` | `YYYY`).
        var groups = rawGroups
        if rawGroups.count >= 6 {
            let interGaps = zip(rawGroups, rawGroups.dropFirst()).map { walls[$1.startIdx] - walls[$0.endIdx] }
            let tightGaps = interGaps.filter { $0 > 0 && $0 <= 0.0105 }
            let wideGaps = interGaps.filter { $0 > 0.0105 && $0 <= 0.065 }
            if !tightGaps.isEmpty && wideGaps.count >= 2 {
                let maxIntra = (tightGaps.max() ?? 0.008) + 0.0015
                var merged: [(startIdx: Int, endIdx: Int, cells: Int, width: CGFloat)] = []
                for g in rawGroups {
                    if let last = merged.last,
                        walls[g.startIdx] - walls[last.endIdx] <= maxIntra,
                        abs((last.width / CGFloat(max(1, last.cells))) - (g.width / CGFloat(max(1, g.cells)))) <= 0.008
                    {
                        let newCells = last.cells + g.cells
                        merged[merged.count - 1] = (last.startIdx, g.endIdx, newCells, walls[g.endIdx] - walls[last.startIdx])
                    } else {
                        merged.append(g)
                    }
                }
                groups = merged
            }
        }
        guard groups.count >= 3 else { return nil }
        for gIdx in 0...(groups.count - 3) {
            let g0 = groups[gIdx]
            let g1 = groups[gIdx + 1]
            let g2 = groups[gIdx + 2]
            let counts = [g0.cells, g1.cells, g2.cells]
            let isDateShape = counts == [2, 2, 4] || counts == [4, 2, 2] || counts == [2, 2, 2]
            guard isDateShape else { continue }
            let gap1 = walls[g1.startIdx] - walls[g0.endIdx]
            let gap2 = walls[g2.startIdx] - walls[g1.endIdx]
            guard gap1 >= 0.005, gap1 <= 0.065, gap2 >= 0.005, gap2 <= 0.065 else { continue }
            var minY = midY - max(rowH * 0.55, 0.011)
            var maxY = midY + max(rowH * 0.55, 0.011)
            let xMid = (walls[g0.startIdx] + walls[g0.startIdx + 1]) * 0.5
            let bg = max(215, lum(xMid, midY))
            for dy in stride(from: rowH * 0.28, through: max(rowH * 1.15, 0.022), by: 0.0015) {
                if lum(xMid, min(0.99, midY + dy)) < bg - 15 { maxY = min(0.99, midY + dy); break }
            }
            for dy in stride(from: rowH * 0.28, through: max(rowH * 1.15, 0.022), by: 0.0015) {
                if lum(xMid, max(0.01, midY - dy)) < bg - 15 { minY = max(0.01, midY - dy); break }
            }
            let h = max(0.018, maxY - minY)
            let rect = CGRect(x: walls[g0.startIdx], y: minY, width: walls[g2.endIdx] - walls[g0.startIdx], height: h)
            let slots = [
                SubSlot(x: walls[g0.startIdx] + 0.002, w: g0.width - 0.004),
                SubSlot(x: walls[g1.startIdx] + 0.002, w: g1.width - 0.004),
                SubSlot(x: walls[g2.startIdx] + 0.002, w: g2.width - 0.004),
            ]
            return (rect, slots)
        }
        return nil
    }

    /// Detects a bordered input box or character-comb grid drawn directly underneath a top-aligned
    /// field heading (such as UK HMRC, EU, or tax forms where labels sit above light-grey boxes).
    func borderedSlotBelow(
        for labelBox: CGRect,
        rightBound: CGFloat,
        pieces: [Piece]
    ) -> (rect: CGRect, comb: Int?, dateSlots: [SubSlot]?)? {
        let baseH = max(labelBox.height, 0.018)
        let searchLeft = max(0.02, labelBox.minX - 0.060)
        let searchRight = min(0.95, rightBound + 0.02)
        guard searchRight - searchLeft >= 0.09 else { return nil }

        for probeOffset in [max(baseH * 0.85, 0.015), max(baseH * 1.35, 0.025), max(baseH * 2.20, 0.046)] {
            let probeY = labelBox.minY - probeOffset
            guard probeY > 0.03 else { continue }
            let belowWalls = verticalWalls(
                from: searchLeft,
                to: searchRight,
                midY: probeY,
                rowH: max(baseH * 1.2, 0.022),
                ignoring: []
            )
            if let trio = detectDateBoxTrio(walls: belowWalls, midY: probeY, rowH: max(baseH * 1.2, 0.022)),
                trio.rect.minX <= labelBox.minX + 0.08
            {
                if pieces.allSatisfy({ !$0.box.intersects(trio.rect.insetBy(dx: 0.004, dy: 0.004)) }) {
                    return (trio.rect, nil, trio.slots)
                }
            }
            if let comb = detectCombGrid(walls: belowWalls, midY: probeY, rowH: max(baseH * 1.2, 0.022)),
                comb.startX <= labelBox.minX + 0.08
            {
                let combRect = CGRect(x: comb.startX, y: comb.minY, width: comb.endX - comb.startX, height: comb.height)
                if pieces.allSatisfy({ !$0.box.intersects(combRect.insetBy(dx: 0.004, dy: 0.004)) }) {
                    return (combRect, comb.cells, nil)
                }
            }
        }

        let ruleEnd = min(rightBound, max(labelBox.minX + 0.14, labelBox.maxX + 0.06))
        guard ruleEnd - labelBox.minX >= 0.10 else { return nil }
        guard let topY = hasHorizontalRule(
            from: labelBox.minX + 0.004,
            to: ruleEnd,
            yLow: max(0.03, labelBox.minY - 0.045),
            yHigh: labelBox.minY + 0.001
        ) else { return nil }
        guard let botY = hasHorizontalRule(
            from: labelBox.minX + 0.004,
            to: ruleEnd,
            yLow: max(0.02, topY - 0.055),
            yHigh: topY - 0.016
        ) else { return nil }
        let midBoxY = (topY + botY) * 0.5
        let boxH = topY - botY
        let boxWalls = verticalWalls(
            from: max(0.02, labelBox.minX - 0.060),
            to: searchRight,
            midY: midBoxY,
            rowH: boxH * 0.85,
            ignoring: []
        )
        guard let leftWall = boxWalls.first(where: { $0 >= labelBox.minX - 0.058 && $0 <= labelBox.minX + 0.040 }),
            let rightWall = boxWalls.last(where: { $0 >= leftWall + 0.10 && $0 <= rightBound + 0.03 })
        else { return nil }
        let boxRect = CGRect(
            x: leftWall + 0.004,
            y: botY + 0.002,
            width: rightWall - leftWall - 0.008,
            height: max(0.018, boxH - 0.004)
        )
        guard pieces.allSatisfy({ !$0.box.intersects(boxRect.insetBy(dx: 0.004, dy: 0.004)) }) else {
            return nil
        }
        return (boxRect, nil, nil)
    }

    /// Detects a small hollow square checkbox outline `□` drawn immediately to the left of a label
    /// (on either its main row or the upper line of a 2-line bilingual label).
    func hasLeadingCheckboxOutline(before labelBox: CGRect) -> Bool {
        let bands: [(CGFloat, CGFloat)] = [
            (labelBox.minY, labelBox.maxY),
            (labelBox.maxY, min(0.98, labelBox.maxY + 0.016)),
        ]
        for (bandLow, bandHigh) in bands where bandHigh > bandLow + 0.006 {
            let searchLeft = max(0.01, labelBox.minX - 0.028)
            let searchRight = labelBox.minX - 0.002
            guard searchRight - searchLeft >= 0.008 else { continue }
            let px0 = max(0, Int(searchLeft * CGFloat(width - 1)))
            let px1 = min(width - 1, Int(searchRight * CGFloat(width - 1)))
            let pyTop = max(0, Int((1.0 - (bandHigh + 0.003)) * CGFloat(height - 1)))
            let pyBot = min(height - 1, Int((1.0 - max(0.01, bandLow - 0.003)) * CGFloat(height - 1)))
            guard px1 - px0 >= 8, pyBot - pyTop >= 8 else { continue }
            let bg = max(lum(searchLeft, min(0.99, bandHigh + 0.01)), 210)

            var darkCols: [Int] = []
            for px in px0...px1 {
                var vDark = 0
                for py in pyTop...pyBot where Int(pixels[py * width + px]) < bg - 30 {
                    vDark += 1
                }
                if Double(vDark) / Double(pyBot - pyTop + 1) >= 0.42 {
                    darkCols.append(px)
                }
            }
            guard let firstCol = darkCols.first, let lastCol = darkCols.last else { continue }
            let boxW = lastCol - firstCol
            let minBoxPx = max(6, Int(0.0055 * CGFloat(width)))
            let maxBoxPx = max(12, Int(0.018 * CGFloat(width)))
            guard boxW >= minBoxPx, boxW <= maxBoxPx else { continue }
            let midPx = (firstCol + lastCol) / 2
            let midPy = (pyTop + pyBot) / 2
            guard Int(pixels[midPy * width + midPx]) >= bg - 18 else { continue }
            var hasTop = false
            var hasBot = false
            for py in pyTop...midPy where Int(pixels[py * width + midPx]) < bg - 28 { hasTop = true; break }
            for py in midPy...pyBot where Int(pixels[py * width + midPx]) < bg - 28 { hasBot = true; break }
            if hasTop && hasBot { return true }
        }
        return false
    }
}

let valueCellUnits: Set<String> = [
    "年", "月", "日", "Year", "Month", "Day", "年 (Year)", "月 (Month)", "日 (Day)",
    "歳", "才", "男", "女", "有", "無", "令和", "平成", "昭和", "西暦",
    "印", "殿", "様", "〒", "-", "ー", "/", "／", "・", "(", ")", "（", "）", "☐", "□", "✓",
]

/// Classifies a printed piece on a form row if it is solely a date delimiter/unit (`Y`, `M`, `D`, or `/`).
func dateDelimiterRole(_ raw: String) -> String? {
    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if t.range(of: #"^(?:年|Year|년|Năm)(?:\s*[\(（]\s*(?:Year|年)\s*[\)）])?$"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return "Y"
    }
    if t.range(of: #"^(?:月|Month|월|Tháng)(?:\s*[\(（]\s*(?:Month|月)\s*[\)）])?$"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return "M"
    }
    if t.range(of: #"^(?:日|Day|일|Ngày)(?:\s*[\(（]\s*(?:Day|日)\s*[\)）])?$"#, options: [.regularExpression, .caseInsensitive]) != nil {
        return "D"
    }
    if t == "/" || t == "／" { return "/" }
    return nil
}

/// Whether a printed token is solely a date format legend (such as `DD MM YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD`).
func isDateFormatHint(_ raw: String) -> Bool {
    let t = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.range(
        of: #"^(?i)[\(\[（]?\s*(?:d{1,4}|m{1,4}|y{2,4}|day|month|year)(?:[\s/\-\.,]+(?:d{1,4}|m{1,4}|y{2,4}|day|month|year)){1,2}\s*[\)\]）]?$"#,
        options: .regularExpression
    ) != nil
}

/// Recognizes a printed inline choice cluster (such as `男・女`, `男・女 (Male/Female)`, `Male / Female`,
/// `Nam / Nữ`, `有・無`, `Yes / No`) so its tokens can be circled directly and never emit a false text slot.
func parseChoiceCluster(_ piece: Piece) -> [ChoiceMark]? {
    let baseBox = piece.primaryBox ?? piece.box
    let primaryText: String
    if piece.primaryBox != nil, let parenIdx = piece.text.range(of: " (")?.lowerBound {
        primaryText = String(piece.text[..<parenIdx]).trimmingCharacters(in: .whitespacesAndNewlines)
    } else {
        primaryText = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let compact = primaryText.replacingOccurrences(of: " ", with: "")
    let pairs: [(pattern: String, first: String, second: String)] = [
        (#"^男[・•·･/／\-,\|]?女$"#, "男", "女"),
        (#"^女[・•·･/／\-,\|]?男$"#, "女", "男"),
        (#"^有[・•·･/／\-,\|]?無$"#, "有", "無"),
        (#"^無[・•·･/／\-,\|]?有$"#, "無", "有"),
        (#"^(?i)male[/／・•·･\-,\|]female$"#, "Male", "Female"),
        (#"^(?i)female[/／・•·･\-,\|]male$"#, "Female", "Male"),
        (#"^(?i)m[/／・•·･\|]f$"#, "M", "F"),
        (#"^(?i)nam[/／・•·･\-,\|]nữ$"#, "Nam", "Nữ"),
        (#"^(?i)yes[/／・•·･\-,\|]no$"#, "Yes", "No"),
    ]
    for item in pairs where compact.range(of: item.pattern, options: .regularExpression) != nil {
        let halfW = max(0.016, baseBox.width * 0.44)
        let padY = max(0.002, baseBox.height * 0.14)
        let leftRect = CGRect(
            x: max(0.005, baseBox.minX - 0.003),
            y: max(0.005, baseBox.minY - padY),
            width: halfW + 0.006,
            height: baseBox.height + padY * 2
        )
        let rightRect = CGRect(
            x: max(leftRect.maxX + 0.002, baseBox.maxX - halfW - 0.003),
            y: max(0.005, baseBox.minY - padY),
            width: halfW + 0.006,
            height: baseBox.height + padY * 2
        )
        return [
            ChoiceMark(option: item.first, rect: leftRect),
            ChoiceMark(option: item.second, rect: rightRect),
        ]
    }
    return nil
}

/// Resolves a profile value (`F`, `Female`, `女`, `M`, `Male`, `男`, etc.) against a field's circleable choices.
func matchChoiceMark(_ rawValue: String, choices: [ChoiceMark]) -> ChoiceMark? {
    let norm = rawValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    guard !norm.isEmpty else { return nil }
    if let exact = choices.first(where: { $0.option.lowercased() == norm }) {
        return exact
    }
    let femaleSet: Set<String> = ["f", "female", "女", "女性", "nữ", "nu", "feminin", "féminin", "weiblich", "femenino", "femmina"]
    let maleSet: Set<String> = ["m", "male", "男", "男性", "nam", "masculin", "männlich", "masculino", "maschio"]
    let yesSet: Set<String> = ["yes", "true", "1", "married", "有", "あり", "既婚", "có"]
    let noSet: Set<String> = ["no", "false", "0", "single", "unmarried", "無", "なし", "未婚", "không"]
    for group in [femaleSet, maleSet, yesSet, noSet] where group.contains(norm) {
        if let hit = choices.first(where: { group.contains($0.option.lowercased()) }) {
            return hit
        }
    }
    return nil
}

func visualWidth(_ s: Substring) -> CGFloat {
    var w: CGFloat = 0
    for ch in s {
        if ch == "\u{2026}" {
            w += 2.6
        } else if ch.unicodeScalars.contains(where: { $0.value >= 0x3000 }) {
            w += 1.8
        } else if ".,:;'!| ".contains(ch) {
            w += 0.42
        } else if "ilI1jtfr()[]/-".contains(ch) {
            w += 0.62
        } else {
            w += 1.0
        }
    }
    return w
}

/// Extracts sub-slots inside a leader span like `....../....../..........` so `/` or `-` delimiters stay intact.
func leaderSubSlots(in leaderSpan: Substring, spanStartX: CGFloat, spanWidth: CGFloat) -> [SubSlot]? {
    let sepChars: Set<Character> = ["/", "／"]
    var segments: [(start: CGFloat, end: CGFloat)] = []
    let total = max(1.0, visualWidth(leaderSpan))
    var segStart: CGFloat = 0
    var pos: CGFloat = 0
    var sepCount = 0
    for ch in leaderSpan {
        let cw = visualWidth(String(ch)[...])
        if sepChars.contains(ch) {
            segments.append((segStart, pos))
            sepCount += 1
            segStart = pos + cw
        }
        pos += cw
    }
    segments.append((segStart, pos))
    guard (sepCount == 2 && segments.count == 3) || (sepCount == 1 && segments.count == 2) else {
        return nil
    }
    let slots = segments.map { seg -> SubSlot in
        let x = spanStartX + spanWidth * (seg.start / total) + 0.003
        let w = spanWidth * ((seg.end - seg.start) / total) - 0.006
        return SubSlot(x: x, w: w)
    }
    return slots.allSatisfy({ $0.w >= 0.032 }) ? slots : nil
}

/// Splits a line that has one or more dotted/underscored fill leaders into separate label pieces,
/// leaving the leader spans as empty horizontal space to be filled (and recording any `/` sub-slots).
func splitLeaderPieces(_ pieces: [Piece]) -> [Piece] {
    let pattern = try! NSRegularExpression(
        pattern: #"(?:…{2,}|[\.…_＿・]{3,}(?:[\s/／\-ー\.…_＿・]*[\.…_＿・]+)*|-{4,}|ー{4,})"#
    )
    var result: [Piece] = []
    for piece in pieces {
        let text = piece.text
        let nsRange = NSRange(text.startIndex..<text.endIndex, in: text)
        let matches = pattern.matches(in: text, options: [], range: nsRange)
        guard !matches.isEmpty else {
            result.append(piece)
            continue
        }
        let total = max(1.0, visualWidth(text[text.startIndex..<text.endIndex]))
        var cursor = text.startIndex
        for match in matches {
            guard let matchRange = Range(match.range, in: text) else { continue }
            let prefix = String(text[cursor..<matchRange.lowerBound])
            if !prefix.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let startOff = visualWidth(text[text.startIndex..<cursor]) / total
                let endOff = visualWidth(text[text.startIndex..<matchRange.lowerBound]) / total
                let matchEndOff = visualWidth(text[text.startIndex..<matchRange.upperBound]) / total
                let x = piece.box.minX + piece.box.width * startOff
                let w = max(0.03, piece.box.width * (endOff - startOff))
                let leaderX = piece.box.minX + piece.box.width * endOff
                let leaderW = piece.box.width * (matchEndOff - endOff)
                let slots = leaderSubSlots(in: text[matchRange], spanStartX: leaderX, spanWidth: leaderW)
                result.append(
                    Piece(
                        text: prefix,
                        box: CGRect(x: x, y: piece.box.minY, width: w, height: piece.box.height),
                        confidence: piece.confidence,
                        leaderSlots: slots
                    )
                )
            }
            cursor = matchRange.upperBound
        }
        if cursor < text.endIndex {
            let tail = String(text[cursor..<text.endIndex])
            if !tail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                let startOff = visualWidth(text[text.startIndex..<cursor]) / total
                let x = piece.box.minX + piece.box.width * startOff
                let w = max(0.03, piece.box.width * (1.0 - startOff))
                result.append(
                    Piece(
                        text: tail,
                        box: CGRect(x: x, y: piece.box.minY, width: w, height: piece.box.height),
                        confidence: piece.confidence
                    )
                )
            }
        }
    }
    return result
}

/// Strips leading item numbers and trailing leader dots/underscores from a printed form label.
func cleanFormLabel(_ raw: String) -> (label: String, leaderRatio: CGFloat?) {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    let withoutLeadingDots = trimmed.replacingOccurrences(
        of: #"^[\s\.…_＿・\-ー/／:：•]+"#,
        with: "",
        options: .regularExpression
    )
    let withoutNumber = withoutLeadingDots.replacingOccurrences(
        of: #"^(?:[0-9]{1,2}(?:\.[0-9]{1,2})?[\.\)\]]?|\([0-9]{1,2}\)|\[[0-9]{1,2}(?:\.[0-9]{1,2})?\]\.?|[①-⑳])\s*"#,
        with: "",
        options: .regularExpression
    )
    let withoutFootnote = withoutNumber.replacingOccurrences(
        of: #"(?:\((?:[0-9]{1,2}|[a-zA-Z])\)|[®©™"'])+[\s:：\.…_＿・\-ー/／]*$"#,
        with: "",
        options: .regularExpression
    )
    let cleaned = withoutFootnote.replacingOccurrences(
        of: #"[\s:：\.…_＿・\-ー/／]+$"#,
        with: "",
        options: .regularExpression
    ).trimmingCharacters(in: .whitespacesAndNewlines)
    return (cleaned, nil)
}

func isCandidateFormLabel(_ cleaned: String, piece: Piece, leaderRatio: CGFloat?) -> Bool {
    guard !cleaned.isEmpty, cleaned.count <= 140 else { return false }
    if cleaned.count == 1 && !piece.text.contains(":") && !piece.text.contains("：") { return false }
    guard cleaned.contains(where: { $0.isLetter }) else { return false }
    guard !valueCellUnits.contains(cleaned), dateDelimiterRole(cleaned) == nil else { return false }
    guard parseChoiceCluster(piece) == nil else { return false }
    if piece.box.width > 0.54 && leaderRatio == nil { return false }
    let lower = cleaned.lowercased()
    if cleaned.hasSuffix("。")
        || cleaned.hasSuffix("ください")
        || cleaned.hasSuffix("ます")
        || cleaned.hasSuffix("すること")
        || cleaned.contains("すること。")
        || cleaned.hasSuffix("殿")
        || cleaned.contains("局長殿")
        || cleaned.range(of: #"様式.*第?[0-9０-９]+号"#, options: .regularExpression) != nil
        || lower.hasPrefix("form no")
        || lower.hasPrefix("omb no")
        || (piece.box.minY > 0.87 && (cleaned.contains("様式") || lower.contains("application for ") || lower.hasPrefix("ministry of ") || lower.hasPrefix("to the director")))
        || lower.hasPrefix("pursuant to ")
        || lower.hasPrefix("i hereby ")
        || lower.hasPrefix("in case that ")
        || lower.hasPrefix("in cases where ")
        || lower.hasPrefix("the date of preparation ")
        || lower == "attention"
        || cleaned == "注意"
        || cleaned == "注 意"
    {
        return false
    }
    return true
}

/// Merges 2-line bilingual labels (a CJK line directly above an English translation subtitle at the
/// same left margin, as on Japanese ISA/MOJ and Korean government forms) into a single combined label
/// spanning the full 2-line cell height so cross-column alignment and primary choice coordinates stay exact.
func mergeBilingualSubtitles(_ pieces: [Piece]) -> [Piece] {
    var used = Set<Int>()
    var out: [Piece] = []
    for (i, top) in pieces.enumerated() {
        if used.contains(i) { continue }
        let hasCJK = top.text.unicodeScalars.contains { $0.value >= 0x3000 }
        if hasCJK {
            let trimmedTop = top.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let hasLeadingNum = trimmedTop.range(of: #"^(?:[0-9]{1,2}[\.\)\s]|\([0-9]{1,2}\)|（[0-9]{1,2}）|[①-⑳])"#, options: .regularExpression) != nil
            var bestSub: Int? = nil
            var bestScore: CGFloat = 999.0
            for (j, sub) in pieces.enumerated() where j != i && !used.contains(j) {
                let isASCII = sub.text.unicodeScalars.allSatisfy { $0.value < 0x0250 }
                let hasAlpha = sub.text.contains { $0.isLetter }
                guard isASCII && hasAlpha else { continue }
                let dy = top.box.minY - sub.box.maxY
                let dxDirect = abs(top.box.minX - sub.box.minX)
                let dxIndented = hasLeadingNum ? abs((top.box.minX + 0.024) - sub.box.minX) : dxDirect
                let dx = min(dxDirect, dxIndented)
                if dy >= -0.009 && dy <= 0.016 && dx <= 0.042 && sub.box.width <= max(top.box.width * 3.6, 0.36) {
                    let score = dx + abs(dy) * 1.5
                    if score < bestScore {
                        bestScore = score
                        bestSub = j
                    }
                }
            }
            if let j = bestSub {
                let firstSub = pieces[j]
                used.insert(j)
                var subGroup = [firstSub]
                for (k, extra) in pieces.enumerated() where k != i && !used.contains(k) {
                    let isASCII = extra.text.unicodeScalars.allSatisfy { $0.value < 0x0250 }
                    guard isASCII, extra.text.contains(where: { $0.isLetter }) else { continue }
                    let sameSubRow = abs(extra.box.midY - firstSub.box.midY) <= max(extra.box.height, firstSub.box.height) * 0.45
                    let underTop = extra.box.minX >= firstSub.box.maxX - 0.004 && extra.box.maxX <= top.box.maxX + 0.035
                    if sameSubRow && underTop {
                        used.insert(k)
                        subGroup.append(extra)
                    }
                }
                subGroup.sort { $0.box.minX < $1.box.minX }
                let subText = subGroup.map(\.text).joined(separator: " ")
                let minX = ([top.box.minX] + subGroup.map(\.box.minX)).min()!
                let maxX = ([top.box.maxX] + subGroup.map(\.box.maxX)).max()!
                let minY = ([top.box.minY] + subGroup.map(\.box.minY)).min()!
                let maxY = ([top.box.maxY] + subGroup.map(\.box.maxY)).max()!
                out.append(
                    Piece(
                        text: "\(top.text) (\(subText))",
                        box: CGRect(
                            x: minX,
                            y: minY,
                            width: maxX - minX,
                            height: max(maxY - minY, top.box.height)
                        ),
                        confidence: ([top.confidence] + subGroup.map(\.confidence)).min()!,
                        leaderSlots: top.leaderSlots ?? firstSub.leaderSlots,
                        primaryBox: top.box
                    )
                )
                continue
            }
        }
        out.append(top)
    }
    return out
}

/// Computes date sub-slots when printed `年 / 月 / 日` or `/` tokens stand inside `[startX .. endX]`
/// on the same row as `labelBox`.
func rowDateSubSlots(allPieces: [Piece], labelBox: CGRect, startX: CGFloat, endX: CGFloat) -> [SubSlot]? {
    let tokens = allPieces
        .compactMap { p -> (role: String, box: CGRect)? in
            let overlapY = min(labelBox.maxY, p.box.maxY) - max(labelBox.minY, p.box.minY)
            guard overlapY >= min(labelBox.height, p.box.height) * 0.35 else { return nil }
            let lbl = cleanFormLabel(p.text).label
            let role = dateDelimiterRole(p.text) ?? dateDelimiterRole(lbl)
            guard let role, p.box.minX > startX + 0.018, p.box.minX < endX + 0.035 else { return nil }
            return (role, p.primaryBox ?? p.box)
        }
        .sorted { $0.box.minX < $1.box.minX }

    var dedupedYmd: [(role: String, box: CGRect)] = []
    for tok in tokens where tok.role == "Y" || tok.role == "M" || tok.role == "D" {
        if let last = dedupedYmd.last, last.role == tok.role, abs(last.box.minX - tok.box.minX) < 0.025 {
            continue
        }
        dedupedYmd.append(tok)
    }
    if dedupedYmd.count >= 3, dedupedYmd[0].role == "Y", dedupedYmd[1].role == "M", dedupedYmd[2].role == "D" {
        let pad: CGFloat = 0.004
        let s1 = SubSlot(x: startX, w: dedupedYmd[0].box.minX - pad - startX)
        let s2 = SubSlot(x: dedupedYmd[0].box.maxX + pad, w: dedupedYmd[1].box.minX - pad - (dedupedYmd[0].box.maxX + pad))
        let s3 = SubSlot(x: dedupedYmd[1].box.maxX + pad, w: dedupedYmd[2].box.minX - pad - (dedupedYmd[1].box.maxX + pad))
        if s1.w >= 0.028, s2.w >= 0.022, s3.w >= 0.022 {
            return [s1, s2, s3]
        }
    }
    // Recover `[Year, Month, Day]` when OCR missed `年`/`Year` next to a vertical cell divider but saw `月` and `日`.
    if dedupedYmd.count == 2, dedupedYmd[0].role == "M", dedupedYmd[1].role == "D" {
        let mBox = dedupedYmd[0].box
        let dBox = dedupedYmd[1].box
        let dayW = dBox.minX - mBox.maxX
        let beforeM = mBox.minX - startX
        if dayW >= 0.032, beforeM >= dayW * 1.85 {
            let pad: CGFloat = 0.004
            let monthW = dayW
            let approxYearRight = mBox.minX - monthW - mBox.width
            if approxYearRight - startX >= 0.036 {
                let s1 = SubSlot(x: startX, w: approxYearRight - pad - startX)
                let s2 = SubSlot(x: approxYearRight + mBox.width + pad, w: mBox.minX - pad - (approxYearRight + mBox.width + pad))
                let s3 = SubSlot(x: mBox.maxX + pad, w: dBox.minX - pad - (mBox.maxX + pad))
                if s1.w >= 0.028, s2.w >= 0.022, s3.w >= 0.022 {
                    return [s1, s2, s3]
                }
            }
        }
    }

    let slashes = tokens.filter { $0.role == "/" }
    if slashes.count == 2 {
        let pad: CGFloat = 0.004
        let s1 = SubSlot(x: startX, w: slashes[0].box.minX - pad - startX)
        let s2 = SubSlot(x: slashes[0].box.maxX + pad, w: slashes[1].box.minX - pad - (slashes[0].box.maxX + pad))
        let s3 = SubSlot(x: slashes[1].box.maxX + pad, w: endX - (slashes[1].box.maxX + pad))
        if s1.w >= 0.032, s2.w >= 0.032, s3.w >= 0.040 {
            return [s1, s2, s3]
        }
    }
    return nil
}

/// Finds circleable options (`男・女`, `Male / Female`, `有・無`, etc.) printed in the value cell to the right of `piece`.
func collectInlineChoices(for piece: Piece, in allPieces: [Piece], rightBound: CGFloat, claimed: inout Set<Int>) -> [ChoiceMark]? {
    let rightCandidates = allPieces.enumerated()
        .filter { idx, other in
            guard !claimed.contains(idx) else { return false }
            let overlapY = min(piece.box.maxY, other.box.maxY) - max(piece.box.minY, other.box.minY)
            return other.box.minX >= piece.box.maxX - 0.004
                && other.box.minX <= rightBound + 0.015
                && overlapY >= min(piece.box.height, other.box.height) * 0.35
        }
        .sorted { $0.element.box.minX < $1.element.box.minX }

    for (idx, cand) in rightCandidates {
        if let cluster = parseChoiceCluster(cand) {
            claimed.insert(idx)
            return cluster
        }
    }

    let singleTokens: [(idx: Int, tok: String, box: CGRect)] = rightCandidates.compactMap { idx, cand in
        let t = cand.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let base = cand.primaryBox ?? cand.box
        if ["男", "女", "有", "無", "Male", "Female", "Yes", "No", "Nam", "Nữ"].contains(t) {
            return (idx, t, base.insetBy(dx: -0.004, dy: -0.002))
        }
        return nil
    }
    if singleTokens.count == 2, singleTokens[0].tok != singleTokens[1].tok {
        claimed.insert(singleTokens[0].idx)
        claimed.insert(singleTokens[1].idx)
        return singleTokens.map { ChoiceMark(option: $0.tok, rect: $0.box) }
    }
    return nil
}

/// Whether a left-margin heading introduces a multi-row role or thematic section (such as `17 法定代理人`,
/// `※ 取次者`, `Part 2. Information About...`, `Employer`, `For official use only`).
func detectSectionHeading(_ row: [Piece]) -> (section: String, resetsOnTopNumber: Bool)? {
    guard let first = row.first, first.box.minX <= 0.16 else { return nil }
    let joined = row.map(\.text).joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    guard !joined.isEmpty else { return nil }
    let lower = joined.lowercased()
    if lower.hasPrefix("pursuant to ") || lower.hasPrefix("in cases where ") || joined.hasPrefix("注意") || joined.hasPrefix("注 意") {
        return nil
    }
    let roleOrBannerPattern = #"(?:^※|^(?i)(?:part|section|sectie|teil|partie|sección|mục|phần)\b|^[■●◆▶]|[一-龯]*代理人|取次者|申請取次|配偶者|扶養家族|雇用主|勤務先|所属機関|世帯主|保証人|記入しないで|官公署記入|市区町村記入|(?i)legal representative|(?i)authorized person|(?i)agent or other|(?i)official use only|(?i)do not write in this|(?i)details of spouse|(?i)employer information)"#
    if joined.range(of: roleOrBannerPattern, options: .regularExpression) != nil {
        return (joined, false)
    }
    let firstTrimmed = first.text.trimmingCharacters(in: .whitespacesAndNewlines)
    if firstTrimmed.range(of: #"^[0-9]{1,2}[\.\s]"#, options: .regularExpression) != nil {
        if row.count >= 2 {
            let secondTrimmed = row[1].text.trimmingCharacters(in: .whitespacesAndNewlines)
            if secondTrimmed.range(of: #"^[\(（][0-9a-zA-Z]{1,2}[\)）]"#, options: .regularExpression) != nil {
                return (firstTrimmed, true)
            }
        }
        return ("", true)
    }
    return nil
}

/// Detects fillable slots on a flat PDF page or photographed paper form from its printed labels.
func visualFormFields(_ rawPieces: [Piece], pageIndex: Int, image: CGImage? = nil) -> [[String: Any]] {
    let pieces = mergeBilingualSubtitles(splitLeaderPieces(rawPieces))
    guard !pieces.isEmpty else { return [] }
    let gray = image.flatMap { GrayBitmap($0) }
    let lineRows = rows(pieces).map { $0.sorted(by: { $0.box.minX < $1.box.minX }) }
    let formRight = min(0.94, max(0.55, (pieces.map(\.box.maxX).max() ?? 0.90) + 0.015))
    var fields: [[String: Any]] = []
    var seenKeys = Set<String>()
    var claimedChoices = Set<Int>()
    var activeSection = ""

    for (rowIndex, row) in lineRows.enumerated() {
        if let heading = detectSectionHeading(row) {
            let trimmedHeading = heading.section.trimmingCharacters(in: .whitespacesAndNewlines)
            if !activeSection.isEmpty,
                !trimmedHeading.isEmpty,
                trimmedHeading.range(of: #"^[\(（][0-9a-zA-Z]{1,2}[\)）]"#, options: .regularExpression) != nil
            {
                activeSection = "\(activeSection) / \(trimmedHeading)"
            } else {
                activeSection = heading.section
            }
        }
        let nonUnits = row.filter {
            let lbl = cleanFormLabel($0.text).label
            return lbl.contains(where: { $0.isLetter })
                && !valueCellUnits.contains(lbl)
                && dateDelimiterRole($0.text) == nil
                && dateDelimiterRole(lbl) == nil
                && !isDateFormatHint($0.text)
                && !isDateFormatHint(lbl)
                && parseChoiceCluster($0) == nil
        }
        guard !nonUnits.isEmpty else { continue }
        let rowMinY = row.map(\.box.minY).min() ?? 0
        let rowHeight = max(row.map(\.box.height).max() ?? 0.02, 0.016)
        let nextRowMaxY = (rowIndex + 1 < lineRows.count)
            ? (lineRows[rowIndex + 1].map(\.box.maxY).max() ?? 0)
            : -1
        let verticalGap = nextRowMaxY >= 0 ? (rowMinY - nextRowMaxY) : 0
        let rowTextBoxes = row.map(\.box)

        for (idx, piece) in nonUnits.enumerated() {
            let rawTrimmed = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
            let startsWithCheckbox = rawTrimmed.range(
                of: #"^(?:[□☐☑✓■▪]|口(?:\s|[一-龯ぁ-んァ-ヶ0-9１-９A-Za-z])|ロ(?:\s|[一-龯ぁ-ん0-9１-９]))"#,
                options: .regularExpression
            ) != nil
            let precededByCheckbox = row.contains { other in
                let t = other.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard t == "□" || t == "☐" || t == "☑" || t == "✓" || t == "口" || t == "ロ" else { return false }
                let gap = piece.box.minX - other.box.maxX
                return gap >= -0.005 && gap <= 0.028
            }
            if startsWithCheckbox || precededByCheckbox { continue }
            if gray?.hasLeadingCheckboxOutline(before: piece.box) == true { continue }

            var (cleaned, leaderRatio) = cleanFormLabel(piece.text)
            guard isCandidateFormLabel(cleaned, piece: piece, leaderRatio: leaderRatio) else { continue }
            let nextPiece = (idx + 1 < nonUnits.count) ? nonUnits[idx + 1] : nil
            if let np = nextPiece,
                idx == 0,
                piece.box.minX <= 0.16,
                np.box.minX - piece.box.maxX < 0.06,
                np.text.trimmingCharacters(in: .whitespaces).range(of: #"^[\(（][0-9]{1,2}[\)）]"#, options: .regularExpression) != nil
            {
                activeSection = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
                continue
            } else if idx == 0,
                piece.box.minX <= 0.16,
                piece.text.range(of: #"^[0-9]{1,2}[\.\s].*[\(（]1[\)）]"#, options: .regularExpression) != nil
            {
                let rawSec = piece.text.trimmingCharacters(in: .whitespacesAndNewlines)
                if let r = rawSec.range(of: #"[\(（]1[\)）].*$"#, options: .regularExpression) {
                    activeSection = String(rawSec[..<r.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
                } else {
                    activeSection = rawSec
                }
            }

            var rightBound = (nextPiece != nil) ? (nextPiece!.box.minX - 0.012) : formRight
            for other in pieces where other.box.minX > piece.box.maxX + 0.014 && other.box.minX - 0.012 < rightBound {
                let overlapY = min(piece.box.maxY, other.box.maxY) - max(piece.box.minY, other.box.minY)
                guard overlapY > 0.003 else { continue }
                let otherLbl = cleanFormLabel(other.text).label
                if otherLbl.isEmpty || valueCellUnits.contains(otherLbl)
                    || dateDelimiterRole(other.text) != nil || dateDelimiterRole(otherLbl) != nil
                    || isDateFormatHint(other.text) || isDateFormatHint(otherLbl)
                    || parseChoiceCluster(other) != nil
                {
                    continue
                }
                rightBound = min(rightBound, other.box.minX - 0.012)
            }
            if let hintPiece = row.first(where: {
                $0.box.minX > piece.box.maxX - 0.004
                    && $0.box.minX <= min(rightBound, piece.box.maxX + 0.14)
                    && (isDateFormatHint($0.text) || isDateFormatHint(cleanFormLabel($0.text).label))
            }) {
                cleaned += " \(hintPiece.text.trimmingCharacters(in: .whitespacesAndNewlines))"
            }

            let choiceMarks = collectInlineChoices(for: piece, in: pieces, rightBound: rightBound, claimed: &claimedChoices)

            var slot: CGRect? = nil
            var combCells: Int? = nil
            var dateSlots: [SubSlot]? = nil

            if let marks = choiceMarks, !marks.isEmpty {
                let unionBox = marks.reduce(marks[0].rect) { $0.union($1.rect) }
                slot = unionBox
            } else if let ratio = leaderRatio {
                let startX = piece.box.minX + piece.box.width * min(0.68, max(0.16, ratio + 0.03))
                let endX = max(piece.box.maxX, rightBound)
                if endX - startX >= 0.07 {
                    slot = CGRect(
                        x: startX,
                        y: piece.box.minY + piece.box.height * 0.04,
                        width: endX - startX,
                        height: max(piece.box.height * 1.15, 0.022)
                    )
                }
            } else if let overlined = gray?.overlinedWritingSlot(for: piece.box, labelText: piece.text, rightBound: rightBound, pieces: pieces) {
                slot = overlined
            } else {
                var startX = piece.box.maxX + 0.015
                var customEndX = rightBound
                let bandTextBoxes = pieces
                    .filter { min(piece.box.maxY, $0.box.maxY) - max(piece.box.minY, $0.box.minY) > 0.002 }
                    .map(\.box)
                let allWalls = gray?.verticalWalls(
                    from: piece.box.maxX + 0.004,
                    to: min(0.95, rightBound + 0.02),
                    midY: piece.box.midY,
                    rowH: piece.box.height,
                    ignoring: bandTextBoxes.isEmpty ? rowTextBoxes : bandTextBoxes
                ) ?? []
                if let comb = gray?.detectCombGrid(walls: allWalls, midY: piece.box.midY, rowH: piece.box.height) {
                    slot = CGRect(
                        x: comb.startX,
                        y: comb.minY,
                        width: comb.endX - comb.startX,
                        height: comb.height
                    )
                    combCells = comb.cells
                } else {
                    let hasColon = piece.text.trimmingCharacters(in: .whitespaces).hasSuffix(":")
                        || piece.text.trimmingCharacters(in: .whitespaces).hasSuffix("：")
                    let hasCellDividerRight = allWalls.contains {
                        $0 <= min(rightBound - 0.08, piece.box.maxX + 0.28)
                    }
                    let insideTableRow = gray?.hasHorizontalRule(
                        from: piece.box.minX,
                        to: min(customEndX, piece.box.maxX + 0.12),
                        yLow: piece.box.maxY - 0.001,
                        yHigh: min(0.99, piece.box.maxY + 0.012)
                    ) != nil
                    if !hasColon, !hasCellDividerRight, !insideTableRow,
                        let below = gray?.borderedSlotBelow(for: piece.box, rightBound: rightBound, pieces: pieces)
                    {
                        slot = below.rect
                        combCells = below.comb
                        dateSlots = below.dateSlots
                    } else {
                        let preSlash = gray?.detectSlashSubSlots(from: startX, to: customEndX, labelBox: piece.box)
                        if allWalls.count >= 6 {
                            startX = allWalls.first!
                            customEndX = allWalls.last!
                        } else if let wallX = allWalls.first, wallX < min(rightBound - 0.08, piece.box.maxX + 0.28) {
                            let wallIsFirstSlash = preSlash != nil
                                && abs(wallX - (preSlash![0].x + preSlash![0].w)) < 0.022
                            if !wallIsFirstSlash {
                                startX = wallX + 0.014
                            }
                        }
                        let rightWidth = customEndX - startX
                        let stackedBelow = !hasColon
                            && nextRowMaxY >= 0
                            && verticalGap >= rowHeight * 1.25
                            && verticalGap <= rowHeight * 4.5
                            && rightWidth < 0.14
                        let minRightWidth: CGFloat = hasColon ? 0.052 : 0.085
                        if !stackedBelow && rightWidth >= minRightWidth {
                            let baseH = piece.primaryBox?.height ?? piece.box.height
                            slot = CGRect(
                                x: startX,
                                y: piece.box.minY,
                                width: rightWidth,
                                height: max(piece.box.height, max(baseH * 1.3, 0.022))
                            )
                        } else {
                            let baseH = piece.primaryBox?.height ?? piece.box.height
                            let belowH = max(baseH * 1.35, 0.022)
                            let belowY = piece.box.minY - belowH * 1.12
                            let belowW = max(piece.box.width, min(0.42, rightBound - piece.box.minX))
                            let belowRect = CGRect(x: piece.box.minX, y: belowY, width: belowW, height: belowH)
                            if belowY > 0.03, pieces.allSatisfy({ !$0.box.intersects(belowRect.insetBy(dx: 0.004, dy: 0.004)) }) {
                                let belowWalls = gray?.verticalWalls(
                                    from: max(0.02, piece.box.minX - 0.01),
                                    to: min(0.95, rightBound + 0.02),
                                    midY: belowRect.midY,
                                    rowH: belowH,
                                    ignoring: []
                                ) ?? []
                                if let belowComb = gray?.detectCombGrid(walls: belowWalls, midY: belowRect.midY, rowH: belowH) {
                                    slot = CGRect(
                                        x: belowComb.startX,
                                        y: belowComb.minY,
                                        width: belowComb.endX - belowComb.startX,
                                        height: belowComb.height
                                    )
                                    combCells = belowComb.cells
                                } else {
                                    slot = belowRect
                                }
                            } else if rightWidth >= 0.065 {
                                slot = CGRect(
                                    x: startX,
                                    y: piece.box.minY,
                                    width: rightWidth,
                                    height: max(piece.box.height, 0.022)
                                )
                            }
                        }
                    }
                }
            }

            guard let box = slot else { continue }
            if cleaned.range(of: #"(?i)\b(?:dd|mm|yyyy)\b"#, options: .regularExpression) == nil {
                let subCaption = pieces
                    .filter {
                        $0.box.maxY <= box.minY + 0.006
                            && $0.box.minY >= box.minY - 0.026
                            && $0.box.minX >= box.minX - 0.02
                            && $0.box.maxX <= box.maxX + 0.05
                    }
                    .sorted { $0.box.minX < $1.box.minX }
                    .map(\.text)
                    .joined(separator: " ")
                if subCaption.range(
                    of: #"(?i)\b(?:day\b.*month\b.*year|d\s*d\b.*m\s*m\b.*y\s*y)"#,
                    options: .regularExpression
                ) != nil {
                    cleaned += " (DD-MM-YYYY)"
                } else if subCaption.range(
                    of: #"(?i)\b(?:month\b.*day\b.*year|m\s*m\b.*d\s*d\b.*y\s*y)"#,
                    options: .regularExpression
                ) != nil {
                    cleaned += " (MM-DD-YYYY)"
                } else if subCaption.range(
                    of: #"(?i)\b(?:year\b.*month\b.*day|y\s*y\s*y\s*y\b.*m\s*m\b.*d\s*d)"#,
                    options: .regularExpression
                ) != nil {
                    cleaned += " (YYYY-MM-DD)"
                }
            }
            if dateSlots == nil && combCells == nil && choiceMarks == nil {
                if let explicitRowSlots = rowDateSubSlots(
                    allPieces: pieces,
                    labelBox: piece.box,
                    startX: box.minX,
                    endX: box.maxX
                ) {
                    dateSlots = explicitRowSlots
                } else if let lSlots = piece.leaderSlots,
                    lSlots.first!.x >= piece.box.maxX - 0.01,
                    lSlots.last!.x + lSlots.last!.w <= rightBound + 0.02
                {
                    dateSlots = lSlots
                } else if let slashSlots = gray?.detectSlashSubSlots(from: box.minX, to: box.maxX, labelBox: piece.box) {
                    dateSlots = slashSlots
                }
            }

            var key = String(
                format: "box:%d:%.4f:%.4f:%.4f:%.4f",
                pageIndex, box.minX, box.minY, box.width, box.height
            )
            if let marks = choiceMarks, !marks.isEmpty {
                let encoded = marks.map {
                    String(
                        format: "%@@%.4f,%.4f,%.4f,%.4f",
                        $0.option, $0.rect.minX, $0.rect.minY, $0.rect.width, $0.rect.height
                    )
                }.joined(separator: ";")
                key += ":choices:\(encoded)"
            } else if let cells = combCells {
                key += ":comb:\(cells)"
            } else if let dSlots = dateSlots, !dSlots.isEmpty {
                let encoded = dSlots.map { String(format: "%.4f,%.4f", $0.x, $0.w) }.joined(separator: ";")
                key += ":slots:\(encoded)"
            }
            guard !seenKeys.contains(key) else { continue }
            seenKeys.insert(key)
            let isSelect = choiceMarks != nil && !(choiceMarks!.isEmpty)
            var entry: [String: Any] = [
                "key": key,
                "name": "",
                "tooltip": "",
                "label": cleaned,
                "section": activeSection,
                "type": isSelect ? "select-one" : "text",
                "maxLength": 0,
                "options": isSelect ? choiceMarks!.map(\.option) : ([] as [String]),
            ]
            if let cells = combCells {
                entry["combCells"] = cells
            }
            if let dSlots = dateSlots {
                entry["dateSlots"] = dSlots.count
            }
            fields.append(entry)
        }
    }
    return fields
}

func parseBoxKey(_ key: String) -> (page: Int, rect: CGRect, comb: Int?, slots: [SubSlot]?, choices: [ChoiceMark]?)? {
    let parts = key.split(separator: ":")
    guard parts.count >= 6, parts[0] == "box",
        let page = Int(parts[1]),
        let x = Double(parts[2]),
        let y = Double(parts[3]),
        let w = Double(parts[4]),
        let h = Double(parts[5])
    else { return nil }
    var comb: Int? = nil
    var slots: [SubSlot]? = nil
    var choices: [ChoiceMark]? = nil
    if parts.count >= 8, parts[6] == "comb", let cells = Int(parts[7]), cells > 1 {
        comb = cells
    } else if parts.count >= 8, parts[6] == "slots" {
        let parsedSlots: [SubSlot] = parts[7].split(separator: ";").compactMap { item in
            let pair = item.split(separator: ",")
            guard pair.count == 2, let sx = Double(pair[0]), let sw = Double(pair[1]), sw > 0 else { return nil }
            return SubSlot(x: sx, w: sw)
        }
        if !parsedSlots.isEmpty {
            slots = parsedSlots
        }
    } else if parts.count >= 8, parts[6] == "choices" {
        let parsedChoices: [ChoiceMark] = parts[7].split(separator: ";").compactMap { item in
            let atParts = item.split(separator: "@", maxSplits: 1)
            guard atParts.count == 2 else { return nil }
            let coords = atParts[1].split(separator: ",")
            guard coords.count == 4,
                let cx = Double(coords[0]),
                let cy = Double(coords[1]),
                let cw = Double(coords[2]),
                let ch = Double(coords[3]),
                cw > 0, ch > 0
            else { return nil }
            return ChoiceMark(option: String(atParts[0]), rect: CGRect(x: cx, y: cy, width: cw, height: ch))
        }
        if !parsedChoices.isEmpty {
            choices = parsedChoices
        }
    }
    return (page, CGRect(x: x, y: y, width: w, height: h), comb, slots, choices)
}

/// Characters to place into `cells` comb boxes: strips formatting hyphens/slashes/spaces when the
/// formatted string exceeds `cells` and the stripped characters fit.
func combCharacters(_ value: String, cells: Int) -> [Character] {
    let noSpaces = Array(value.filter { !$0.isWhitespace })
    if noSpaces.count <= cells {
        return noSpaces
    }
    let alnum = noSpaces.filter { !"-/.–—()".contains($0) }
    return (!alnum.isEmpty && alnum.count <= cells) ? alnum : noSpaces
}

/// Splits a formatted date or segmented number (e.g. `1985年12月31日`, `令和8年3月31日`, `26/08/2006`,
/// `1985-12-31`) into sub-slot strings without the pre-printed delimiters.
func segmentedParts(_ value: String, slots: [SubSlot]) -> [String]? {
    guard slots.count >= 2 else { return nil }
    let separators = CharacterSet(charactersIn: "年月日/／-ー.")
    let parts = value
        .components(separatedBy: separators)
        .map { $0.trimmingCharacters(in: .whitespaces) }
        .filter { !$0.isEmpty }
    if parts.count != slots.count {
        if slots.count == 3 {
            let digits = Array(value.filter { $0.isASCII && $0.isNumber })
            if digits.count == 8 {
                let first4 = Int(String(digits[0..<4])) ?? 0
                let last4 = Int(String(digits[4..<8])) ?? 0
                if (1850...2150).contains(first4) {
                    let y = String(digits[0..<4])
                    let m = String(digits[4..<6])
                    let d = String(digits[6..<8])
                    return (slots[0].w < slots[2].w * 0.72) ? [d, m, y] : [y, m, d]
                } else if (1850...2150).contains(last4) {
                    return [String(digits[0..<2]), String(digits[2..<4]), String(digits[4..<8])]
                }
            }
        }
        return nil
    }
    // Align a 4-digit ISO year (`YYYY-MM-DD`) when the form's third slot is clearly the wide year slot (`DD/MM/YYYY`).
    if parts.count == 3,
        parts[0].count == 4, parts[0].allSatisfy(\.isNumber),
        parts[2].count <= 2, parts[2].allSatisfy(\.isNumber),
        slots[0].w < slots[2].w * 0.72
    {
        return [parts[2], parts[1], parts[0]]
    }
    return parts
}

func fillFont(size: CGFloat) -> NSFont {
    NSFont(name: "HiraginoSans-W6", size: size)
        ?? NSFont(name: "PingFangSC-Semibold", size: size)
        ?? NSFont.systemFont(ofSize: size, weight: .semibold)
}

func monoBadgeFont(size: CGFloat) -> NSFont {
    NSFont.monospacedSystemFont(ofSize: size, weight: .semibold)
}

/// Writes matched values (or `@vk:` blueprint badges) onto an image of a paper form and saves the image to `outURL`.
func fillImageForm(sourceURL: URL, outURL: URL, values: [String: String]) -> Int {
    guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil),
        let rawImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { fail("cannot read the form image") }
    let image = deskewFormImage(orientedCGImage(rawImage, orientation(of: source)))
    let width = CGFloat(image.width)
    let height = CGFloat(image.height)
    guard let rep = NSBitmapImageRep(
        bitmapDataPlanes: nil,
        pixelsWide: image.width,
        pixelsHigh: image.height,
        bitsPerSample: 8,
        samplesPerPixel: 4,
        hasAlpha: true,
        isPlanar: false,
        colorSpaceName: .calibratedRGB,
        bytesPerRow: 0,
        bitsPerPixel: 0
    ), let graphics = NSGraphicsContext(bitmapImageRep: rep) else {
        fail("cannot create image graphics context")
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.cgContext.interpolationQuality = .high
    graphics.cgContext.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))

    let inkColor = NSColor(calibratedRed: 0.04, green: 0.15, blue: 0.42, alpha: 0.98)
    func localPaperColor(around box: CGRect, alpha: CGFloat = 0.78) -> NSColor {
        let sx = max(0, min(Int(width) - 1, Int(box.minX + min(12, box.width * 0.2))))
        let sy = max(0, min(Int(height) - 1, Int(height - box.midY)))
        var bestR: CGFloat = 1.0
        var bestG: CGFloat = 1.0
        var bestB: CGFloat = 1.0
        var bestLuma: CGFloat = -1.0
        for dy in stride(from: -6, through: 6, by: 3) {
            for dx in stride(from: 0, through: 24, by: 6) {
                let px = max(0, min(Int(width) - 1, sx + dx))
                let py = max(0, min(Int(height) - 1, sy + dy))
                if let c = rep.colorAt(x: px, y: py)?.usingColorSpace(.sRGB) {
                    let luma = 0.299 * c.redComponent + 0.587 * c.greenComponent + 0.114 * c.blueComponent
                    if luma > bestLuma {
                        bestLuma = luma
                        bestR = c.redComponent
                        bestG = c.greenComponent
                        bestB = c.blueComponent
                    }
                }
            }
        }
        return NSColor(calibratedRed: bestR, green: bestG, blue: bestB, alpha: alpha)
    }
    var count = 0

    for (key, value) in values {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let parsed = parseBoxKey(key), parsed.page == 0 else { continue }
        let box = CGRect(
            x: parsed.rect.minX * width,
            y: parsed.rect.minY * height,
            width: parsed.rect.width * width,
            height: parsed.rect.height * height
        )
        let backingColor = localPaperColor(around: box)

        let isVkTag = trimmed.hasPrefix("@vk:") || trimmed.hasPrefix("🔒 @vk:")
        let isSkipTag = trimmed.hasPrefix("⚠ SKIP:")

        if isVkTag || isSkipTag {
            let isAsk = trimmed.hasPrefix("🔒")
            let bgColor: NSColor
            let borderColor: NSColor
            let textColor: NSColor
            if isSkipTag {
                bgColor = NSColor(calibratedRed: 1.0, green: 0.97, blue: 0.92, alpha: 0.94)
                borderColor = NSColor(calibratedRed: 0.85, green: 0.47, blue: 0.02, alpha: 0.85)
                textColor = NSColor(calibratedRed: 0.57, green: 0.25, blue: 0.05, alpha: 1.0)
            } else if isAsk {
                bgColor = NSColor(calibratedRed: 0.96, green: 0.93, blue: 1.0, alpha: 0.95)
                borderColor = NSColor(calibratedRed: 0.49, green: 0.23, blue: 0.93, alpha: 0.92)
                textColor = NSColor(calibratedRed: 0.30, green: 0.11, blue: 0.58, alpha: 1.0)
            } else {
                bgColor = NSColor(calibratedRed: 0.93, green: 0.95, blue: 1.0, alpha: 0.95)
                borderColor = NSColor(calibratedRed: 0.23, green: 0.38, blue: 0.96, alpha: 0.90)
                textColor = NSColor(calibratedRed: 0.12, green: 0.23, blue: 0.54, alpha: 1.0)
            }

            var fontSize = min(max(11, box.height * 0.52), 20)
            var font = monoBadgeFont(size: fontSize)
            var attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: textColor,
            ]
            var measured = (trimmed as NSString).size(withAttributes: attrs)
            if measured.width > box.width - 12, measured.width > 0 {
                fontSize = max(9, fontSize * ((box.width - 12) / measured.width))
                font = monoBadgeFont(size: fontSize)
                attrs[.font] = font
                measured = (trimmed as NSString).size(withAttributes: attrs)
            }
            let drawY = box.minY + max(0, (box.height - measured.height) * 0.5)
            let pillRect = CGRect(
                x: box.minX + 3,
                y: drawY - 2,
                width: min(box.width - 4, measured.width + 14),
                height: measured.height + 4
            )
            let pill = NSBezierPath(roundedRect: pillRect, xRadius: 6, yRadius: 6)
            bgColor.setFill()
            pill.fill()
            borderColor.setStroke()
            pill.lineWidth = isSkipTag ? 1.2 : 1.5
            if isSkipTag {
                let pattern: [CGFloat] = [4.0, 2.5]
                pill.setLineDash(pattern, count: 2, phase: 0)
            }
            pill.stroke()
            (trimmed as NSString).draw(
                at: NSPoint(x: pillRect.minX + 7, y: drawY),
                withAttributes: attrs
            )
            count += 1
            continue
        }

        if let choices = parsed.choices, let hit = matchChoiceMark(trimmed, choices: choices) {
            let ovalRect = CGRect(
                x: hit.rect.minX * width,
                y: hit.rect.minY * height,
                width: hit.rect.width * width,
                height: hit.rect.height * height
            ).insetBy(dx: -3, dy: -2)
            let oval = NSBezierPath(ovalIn: ovalRect)
            inkColor.setStroke()
            oval.lineWidth = max(2.2, min(4.0, ovalRect.height * 0.10))
            oval.stroke()
            count += 1
            continue
        }

        if let cells = parsed.comb, cells > 1 {
            let chars = combCharacters(trimmed, cells: cells)
            let cellW = box.width / CGFloat(cells)
            let fontSize = min(max(13, box.height * 0.62), cellW * 0.78, 28)
            let font = fillFont(size: fontSize)
            let attrs: [NSAttributedString.Key: Any] = [
                .font: font,
                .foregroundColor: inkColor,
            ]
            for (idx, ch) in chars.prefix(cells).enumerated() {
                let s = String(ch) as NSString
                let m = s.size(withAttributes: attrs)
                let cellX = box.minX + CGFloat(idx) * cellW
                let drawX = cellX + max(1, (cellW - m.width) * 0.5)
                let drawY = box.minY + max(0, (box.height - m.height) * 0.5)
                s.draw(at: NSPoint(x: drawX, y: drawY), withAttributes: attrs)
            }
            count += 1
            continue
        }

        if let subSlots = parsed.slots, let parts = segmentedParts(trimmed, slots: subSlots) {
            for (part, slot) in zip(parts, subSlots) {
                let subBox = CGRect(
                    x: slot.x * width,
                    y: box.minY,
                    width: slot.w * width,
                    height: box.height
                )
                var fontSize = min(max(12, subBox.height * 0.66), 30)
                var font = fillFont(size: fontSize)
                var attrs: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: inkColor,
                ]
                var measured = (part as NSString).size(withAttributes: attrs)
                if measured.width > subBox.width - 4, measured.width > 0 {
                    fontSize = max(9, fontSize * ((subBox.width - 4) / measured.width))
                    font = fillFont(size: fontSize)
                    attrs[.font] = font
                    measured = (part as NSString).size(withAttributes: attrs)
                }
                let drawX = subBox.minX + max(1, (subBox.width - measured.width) * 0.5)
                let drawY = subBox.minY + max(0, (subBox.height - measured.height) * 0.5)
                // Draw directly as ink inside the sub-slot so printed `年 / 月 / 日` and `/` stay completely untouched.
                (part as NSString).draw(at: NSPoint(x: drawX, y: drawY), withAttributes: attrs)
            }
            count += 1
            continue
        }

        let charCount = max(CGFloat(trimmed.count), 1)
        let maxFontByHeight = max(13, min(box.height * 0.68, 34))
        let maxFontByWidth = max(11, (box.width * 0.94) / max(charCount * 0.62, 1))
        var fontSize = min(maxFontByHeight, maxFontByWidth)
        var font = fillFont(size: fontSize)
        var attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: inkColor,
        ]
        var measured = (trimmed as NSString).size(withAttributes: attrs)
        if measured.width > box.width - 8, measured.width > 0 {
            fontSize = max(10, fontSize * ((box.width - 8) / measured.width))
            font = fillFont(size: fontSize)
            attrs[.font] = font
            measured = (trimmed as NSString).size(withAttributes: attrs)
        }
        let drawY = box.minY + max(0, (box.height - measured.height) * 0.5)
        let drawRect = CGRect(
            x: box.minX + 4,
            y: drawY,
            width: measured.width + 6,
            height: measured.height
        )
        let pill = NSBezierPath(
            roundedRect: drawRect.insetBy(dx: -3, dy: -1),
            xRadius: 3,
            yRadius: 3
        )
        backingColor.setFill()
        pill.fill()
        (trimmed as NSString).draw(
            at: NSPoint(x: drawRect.minX, y: drawRect.minY),
            withAttributes: attrs
        )
        count += 1
    }

    NSGraphicsContext.restoreGraphicsState()
    let ext = outURL.pathExtension.lowercased()
    let fileType: NSBitmapImageRep.FileType = (ext == "jpg" || ext == "jpeg") ? .jpeg : .png
    let props: [NSBitmapImageRep.PropertyKey: Any] = (fileType == .jpeg) ? [.compressionFactor: 0.94] : [:]
    guard let data = rep.representation(using: fileType, properties: props),
        (try? data.write(to: outURL)) != nil
    else { fail("cannot write the filled form image") }
    return count
}

if arguments.first == "--front" {
    var front: [String: String] = [:]
    if let app = NSWorkspace.shared.frontmostApplication {
        front["app"] = app.localizedName ?? ""
        let element = AXUIElementCreateApplication(app.processIdentifier)
        var window: CFTypeRef?
        if AXUIElementCopyAttributeValue(element, kAXFocusedWindowAttribute as CFString, &window) == .success,
            let window
        {
            var value: CFTypeRef?
            // swiftlint:disable:next force_cast
            let focused = window as! AXUIElement
            if AXUIElementCopyAttributeValue(focused, kAXTitleAttribute as CFString, &value) == .success {
                front["title"] = value as? String ?? ""
            }
            if AXUIElementCopyAttributeValue(focused, kAXDocumentAttribute as CFString, &value) == .success,
                let location = value as? String, let url = URL(string: location), url.isFileURL
            {
                front["document"] = url.path
            }
        }
    }
    let data = try! JSONSerialization.data(withJSONObject: front, options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

/// Nearest section heading printed above an interactive widget on an AcroForm page.
func sectionNear(_ lines: [Line], _ box: CGRect, pageBounds: CGRect) -> String {
    let sectionPattern = #"(?:^※|^(?i)(?:part|section|sectie|teil|partie|sección|mục|phần)\b|^[■●◆▶]|[一-龯]*代理人|取次者|申請取次|配偶者|扶養家族|雇用主|勤務先|所属機関|世帯主|保証人|記入しないで|官公署記入|市区町村記入|(?i)legal representative|(?i)authorized person|(?i)agent or other|(?i)official use only|(?i)do not write in this|(?i)details of spouse|(?i)employer information)"#
    var best: (dy: CGFloat, text: String)? = nil
    for line in lines {
        let dy = line.box.minY - box.maxY
        guard dy >= -4, dy <= pageBounds.height * 0.32 else { continue }
        let spansLeftOrFull = line.box.minX <= pageBounds.minX + pageBounds.width * 0.28
            || line.box.width >= pageBounds.width * 0.45
        let sameColumn = box.midX >= line.box.minX - 18 && box.minX <= line.box.maxX + 60
        guard spansLeftOrFull || sameColumn else { continue }
        let trimmed = line.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.range(of: sectionPattern, options: .regularExpression) != nil else { continue }
        if best == nil || dy < best!.dy {
            best = (dy, trimmed)
        }
    }
    return best?.text ?? ""
}

/// Classifies a PDF or image as a blank fillable `"form"`, a personal source `"document"`, or `"ambiguous"`
/// from its printed layout and structure rather than its file name.
func classifyLayout(url: URL) -> [String: Any] {
    var widgetCount = 0
    var formSignals = 0
    var docSignals = 0

    func scorePieces(_ pieces: [Piece], image: CGImage?, aspect: CGFloat) {
        let allText = pieces.map(\.text).joined(separator: "\n")
        let lower = allText.lowercased()
        if let image {
            if !harvestMrzPieces(image).isEmpty {
                docSignals += 5
            }
            let bcReq = VNDetectBarcodesRequest()
            if (try? VNImageRequestHandler(cgImage: image, orientation: .up, options: [:]).perform([bcReq])) != nil,
                let payloads = bcReq.results?.compactMap(\.payloadStringValue),
                payloads.contains(where: { $0.count >= 45 })
            {
                docSignals += 4
            }
        }
        let formHeaderPattern = #"(?:申請書|届出書|申告書|申込書|願書|請求書|調査票|問診票|記入例|(?i)\bapplication\s+(?:form|for)\b|(?i)\bregistration\s+form\b|(?i)\bdeclaration\b|(?i)\benrollment\s+form\b|(?i)\bintake\s+form\b|(?i)\btờ\s+khai\b|(?i)\bđơn\s+(?:đề\s+nghị|đăng\s+ký|xin)\b|(?i)\bantrag\s+auf\b|(?i)\banmeldung\b|(?i)\bformular\b|(?i)\bformulaire\b|(?i)\bdemande\s+de\b|(?i)\bsolicitud\s+de\b|(?i)\baanvraag\b|신청서|신고서)"#
        let hasFormHeader = allText.range(of: formHeaderPattern, options: .regularExpression) != nil
        if hasFormHeader {
            formSignals += 4
        }
        let docHeaderPattern = #"(?:運転免許証|在留カード|個人番号カード|住民票の写し|源泉徴収票|健康保険証|確認票|給与明細|支給明細|雇用契約|労働条件通知|証明書|謄本|抄本|(?i)\bresidence\s+card\b|(?i)\bdriver'?s?\s+licen[cs]e\b|(?i)\bcăn\s+cước\b|(?i)\bchứng\s+minh\s+nhân\s+dân\b|(?i)\bpermis\s+de\s+conduire\b|(?i)\bpersonalausweis\b|(?i)\bpassbook\b|(?i)\bbank\s+statement\b|(?i)\bpayslip\b|(?i)\bpay\s+stub\b|(?i)\bemployment\s+contract\b|(?i)\bcertificate\s+of\b)"#
        if !hasFormHeader && (allText.range(of: docHeaderPattern, options: .regularExpression) != nil || (lower.contains("passport") && !lower.contains("passport number") && !lower.contains("passport no"))) {
            docSignals += 4
        }

        let filledKvHits = pieces.filter { p in
            let t = p.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !t.contains("例:") && !t.contains("例：") && !t.lowercased().contains("e.g.") else { return false }
            return t.range(of: #"^[^:：\.…_＿]{1,28}[：:]\s*[^\s\.…_＿\(\)（）]{2,}"#, options: .regularExpression) != nil
        }.count
        if filledKvHits >= 4 {
            docSignals += 5
        } else if filledKvHits >= 2 {
            docSignals += 3
        }

        let checkboxHits = pieces.filter {
            $0.text.range(of: #"(?:[□☐☑]|(?:^|\s)(?:口|ロ)\s*[一-龯ぁ-んァ-ヶA-Za-z])"#, options: .regularExpression) != nil
        }.count
        if checkboxHits >= 2 {
            formSignals += 3
        }
        let leaderHits = pieces.filter {
            $0.text.contains("...") || $0.text.contains("___") || $0.text.contains("…")
        }.count
        if leaderHits >= 3 {
            formSignals += 3
        }

        let vFields = visualFormFields(pieces, pageIndex: 0, image: image)
        let combCount = vFields.filter { $0["combCells"] != nil }.count
        let dateSlotCount = vFields.filter { $0["dateSlots"] != nil }.count
        let choiceCount = vFields.filter { ($0["type"] as? String) == "select-one" }.count

        if combCount >= 1 { formSignals += 3 }
        if dateSlotCount >= 2 { formSignals += 4 } else if dateSlotCount == 1 { formSignals += 2 }
        if choiceCount >= 1 { formSignals += 2 }
        if vFields.count >= 16 { formSignals += 3 } else if vFields.count >= 9 { formSignals += 2 }

        if aspect >= 1.25 && aspect <= 1.85 && pieces.count <= 28 && combCount == 0 && checkboxHits == 0 && !hasFormHeader {
            docSignals += 2
        }
    }

    if url.pathExtension.lowercased() == "pdf" {
        if let rawData = try? Data(contentsOf: url),
            let latin = String(data: rawData.prefix(512 * 1024), encoding: .isoLatin1),
            latin.contains("<field") && latin.contains("xfa")
        {
            return ["kind": "form", "widgets": 1, "formSignals": 10, "docSignals": 0]
        }
        guard let document = openPDFDocument(url) else {
            return ["kind": "document", "widgets": 0, "formSignals": 0, "docSignals": 0]
        }
        widgetCount = widgets(document).count
        if widgetCount > 0 {
            return ["kind": "form", "widgets": widgetCount, "formSignals": 10, "docSignals": 0]
        }
        if let page = document.page(at: 0) {
            let bounds = page.bounds(for: .mediaBox)
            let aspect = bounds.width / max(1, bounds.height)
            if let image = pageImage(page) {
                let pieces = recognizePieces(image, split: true)
                scorePieces(pieces, image: image, aspect: aspect)
            } else {
                let printed = textLayerLines(page).map { run in
                    Piece(
                        text: run.text,
                        box: CGRect(
                            x: (run.box.minX - bounds.minX) / bounds.width,
                            y: (run.box.minY - bounds.minY) / bounds.height,
                            width: run.box.width / bounds.width,
                            height: run.box.height / bounds.height
                        )
                    )
                }
                scorePieces(printed, image: nil, aspect: aspect)
            }
        }
    } else if let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let rawImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
    {
        let upright = orientedCGImage(rawImage, orientation(of: source))
        let image = deskewFormImage(upright)
        imageOrientation = .up
        let pieces = recognizePieces(image, split: true)
        let aspect = CGFloat(image.width) / max(1, CGFloat(image.height))
        scorePieces(pieces, image: image, aspect: aspect)
    }

    let kind: String
    if docSignals >= 5 && docSignals >= formSignals + 2 {
        kind = "document"
    } else if docSignals >= 4 && formSignals <= 4 {
        kind = "document"
    } else if formSignals >= 5 && formSignals >= docSignals + 2 {
        kind = "form"
    } else if docSignals >= 2 && formSignals <= 2 {
        kind = "document"
    } else if formSignals <= 2 {
        kind = "document"
    } else {
        kind = "ambiguous"
    }
    return [
        "kind": kind,
        "widgets": widgetCount,
        "formSignals": formSignals,
        "docSignals": docSignals,
    ]
}

if arguments.first == "--classify" {
    guard arguments.count == 2 else { fail(usage, 2) }
    let targetURL = URL(fileURLWithPath: arguments[1])
    let result = classifyLayout(url: targetURL)
    let data = try! JSONSerialization.data(withJSONObject: result, options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

if arguments.first == "--form" {
    guard arguments.count == 2 else { fail(usage, 2) }
    let formURL = URL(fileURLWithPath: arguments[1])
    var fields: [[String: Any]] = []
    if formURL.pathExtension.lowercased() == "pdf" {
        guard let document = openPDFDocument(formURL) else { fail("cannot read the PDF: \(formURL.path)", 2) }
        let found = widgets(document)
        if !found.isEmpty {
            // A page whose text layer does not say what the page shows (a font with no Unicode mapping, or
            // a scan) is named from what text recognition reads on it, as Preview does.
            func letters(_ lines: [Line]) -> Set<Character> {
                Set(lines.flatMap { $0.text }.filter { $0.isLetter })
            }
            var labels: [Int: [String]] = [:]
            var sections: [Int: [String]] = [:]
            for pageIndex in Set(found.map(\.pageIndex)) {
                guard let page = document.page(at: pageIndex) else { continue }
                let pageBounds = page.bounds(for: .mediaBox)
                let boxes = found.filter { $0.pageIndex == pageIndex }.map(\.widget.bounds)
                let printed = textLayerLines(page)
                let seen = recognizedLines(page)
                let read = letters(seen)
                let agree = read.isEmpty ? 1 : Double(letters(printed).intersection(read).count) / Double(read.count)
                let lines = agree >= 0.5 ? printed : seen
                labels[pageIndex] = boxes.map { labelNear(lines, $0) }
                sections[pageIndex] = boxes.map { sectionNear(lines, $0, pageBounds: pageBounds) }
            }
            var placeOnPage: [Int: Int] = [:]
            var seen = Set<String>()
            for (_, pageIndex, index, widget) in found {
                let place = placeOnPage[pageIndex, default: 0]
                placeOnPage[pageIndex] = place + 1
                let key = fieldKey(widget, page: pageIndex, index: index)
                guard !seen.contains(key) else { continue }
                seen.insert(key)
                let kind: String
                switch widget.widgetFieldType {
                case .text: kind = "text"
                case .choice: kind = "select-one"
                case .button: kind = widget.widgetControlType == .checkBoxControl ? "checkbox" : "button"
                default: kind = "other"
                }
                fields.append([
                    "key": key,
                    "name": widget.fieldName ?? "",
                    "tooltip": (widget.value(forAnnotationKey: PDFAnnotationKey(rawValue: "/TU")) as? String) ?? "",
                    "label": labels[pageIndex]?[place] ?? "",
                    "section": sections[pageIndex]?[place] ?? "",
                    "type": kind,
                    "maxLength": widget.maximumLength,
                    "options": widget.choices ?? [],
                ])
            }
        } else {
            for pageIndex in 0..<document.pageCount {
                guard let page = document.page(at: pageIndex) else { continue }
                let bounds = page.bounds(for: .mediaBox)
                let printed = textLayerLines(page).map { run in
                    Piece(
                        text: run.text,
                        box: CGRect(
                            x: (run.box.minX - bounds.minX) / bounds.width,
                            y: (run.box.minY - bounds.minY) / bounds.height,
                            width: run.box.width / bounds.width,
                            height: run.box.height / bounds.height
                        )
                    )
                }
                let hasLeaders = printed.contains {
                    $0.text.contains("...") || $0.text.contains("___") || $0.text.contains("…")
                }
                if hasLeaders && printed.count >= 6 {
                    fields.append(contentsOf: visualFormFields(printed, pageIndex: pageIndex, image: pageImage(page)))
                } else if let image = pageImage(page) {
                    let pieces = recognizePieces(image, split: true)
                    fields.append(contentsOf: visualFormFields(pieces, pageIndex: pageIndex, image: image))
                }
            }
        }
    } else {
        guard let source = CGImageSourceCreateWithURL(formURL as CFURL, nil),
            let rawImage = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { fail("cannot read the form image", 2) }
        let image = deskewFormImage(orientedCGImage(rawImage, orientation(of: source)))
        imageOrientation = .up
        let pieces = recognizePieces(image, split: true)
        fields = visualFormFields(pieces, pageIndex: 0, image: image)
    }
    let data = try! JSONSerialization.data(withJSONObject: ["fields": fields], options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

if arguments.first == "--fill" {
    guard arguments.count == 3 else { fail(usage, 2) }
    let sourceURL = URL(fileURLWithPath: arguments[1])
    let outURL = URL(fileURLWithPath: arguments[2])
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let values = (try? JSONSerialization.jsonObject(with: input)) as? [String: String]
    else { fail("expected a JSON object of field values on stdin", 2) }
    if sourceURL.pathExtension.lowercased() == "pdf" {
        guard var document = openPDFDocument(sourceURL) else { fail("cannot read the PDF: \(sourceURL.path)", 2) }
        var filled = Set<String>()
        for (_, pageIndex, index, widget) in widgets(document) {
            let key = fieldKey(widget, page: pageIndex, index: index)
            guard let value = values[key] else { continue }
            switch widget.widgetFieldType {
            case .text, .choice:
                widget.widgetStringValue = value
                filled.insert(key)
            case .button where widget.widgetControlType == .checkBoxControl:
                widget.buttonWidgetState = .onState
                filled.insert(key)
            default:
                continue
            }
        }
        let needsBoxAnnotations = values.keys.contains { !filled.contains($0) && parseBoxKey($0) != nil }
        if needsBoxAnnotations && !document.allowsCommenting {
            document = annotatablePDFDocument(document)
        }
        let inkColor = NSColor(calibratedRed: 0.04, green: 0.15, blue: 0.42, alpha: 0.98)
        func addFreeText(on page: PDFPage, rect: CGRect, text: String, centered: Bool) {
            let charCount = max(CGFloat(text.count), 1)
            var fontSize = min(
                max(8, min(rect.height * 0.62, 16)),
                max(7.5, (rect.width * 0.92) / max(charCount * 0.62, 1))
            )
            var font = fillFont(size: fontSize)
            var measured = (text as NSString).size(withAttributes: [.font: font])
            if measured.width > rect.width - 2, measured.width > 0 {
                fontSize = max(7, fontSize * ((rect.width - 2) / measured.width))
                font = fillFont(size: fontSize)
                measured = (text as NSString).size(withAttributes: [.font: font])
            }
            let drawRect = centered
                ? CGRect(
                    x: rect.minX + max(0, (rect.width - measured.width - 4) * 0.5),
                    y: rect.minY + max(0, (rect.height - measured.height - 2) * 0.5),
                    width: min(rect.width, measured.width + 6),
                    height: min(rect.height * 1.15, measured.height + 4)
                )
                : rect
            let annotation = PDFAnnotation(bounds: drawRect, forType: .freeText, withProperties: nil)
            annotation.contents = text
            annotation.font = font
            annotation.fontColor = inkColor
            annotation.color = .clear
            if centered {
                annotation.alignment = .center
            }
            let border = PDFBorder()
            border.lineWidth = 0
            annotation.border = border
            page.addAnnotation(annotation)
        }

        for (key, value) in values where !filled.contains(key) {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, let parsed = parseBoxKey(key),
                let page = document.page(at: parsed.page)
            else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let rect = CGRect(
                x: bounds.minX + parsed.rect.minX * bounds.width,
                y: bounds.minY + parsed.rect.minY * bounds.height,
                width: parsed.rect.width * bounds.width,
                height: parsed.rect.height * bounds.height
            )
            if let choices = parsed.choices, let hit = matchChoiceMark(trimmed, choices: choices) {
                let cRect = CGRect(
                    x: bounds.minX + hit.rect.minX * bounds.width,
                    y: bounds.minY + hit.rect.minY * bounds.height,
                    width: hit.rect.width * bounds.width,
                    height: hit.rect.height * bounds.height
                ).insetBy(dx: -2.0, dy: -1.5)
                let circle = PDFAnnotation(bounds: cRect, forType: .circle, withProperties: nil)
                circle.color = inkColor
                circle.interiorColor = .clear
                let border = PDFBorder()
                border.lineWidth = 1.6
                circle.border = border
                page.addAnnotation(circle)
                filled.insert(key)
                continue
            }
            if let cells = parsed.comb, cells > 1 {
                let chars = combCharacters(trimmed, cells: cells)
                let cellW = rect.width / CGFloat(cells)
                for (idx, ch) in chars.prefix(cells).enumerated() {
                    let cellRect = CGRect(
                        x: rect.minX + CGFloat(idx) * cellW,
                        y: rect.minY,
                        width: cellW,
                        height: rect.height
                    )
                    addFreeText(on: page, rect: cellRect, text: String(ch), centered: true)
                }
                filled.insert(key)
                continue
            }
            if let subSlots = parsed.slots, let parts = segmentedParts(trimmed, slots: subSlots) {
                for (part, slot) in zip(parts, subSlots) {
                    let subRect = CGRect(
                        x: bounds.minX + slot.x * bounds.width,
                        y: rect.minY,
                        width: slot.w * bounds.width,
                        height: rect.height
                    )
                    addFreeText(on: page, rect: subRect, text: part, centered: true)
                }
                filled.insert(key)
                continue
            }
            addFreeText(on: page, rect: rect, text: trimmed, centered: false)
            filled.insert(key)
        }
        guard document.write(to: outURL) else { fail("cannot write the filled PDF") }
        print(filled.count)
        exit(0)
    } else {
        let count = fillImageForm(sourceURL: sourceURL, outURL: outURL, values: values)
        print(count)
        exit(0)
    }
}

if arguments.first == "--pieces" {
    guard arguments.count == 2 else { fail(usage, 2) }
    let location = URL(fileURLWithPath: arguments[1])
    func place(_ pieces: [Piece], index: Int, aspect: CGFloat) -> [String: Any] {
        [
            "index": index,
            "aspect": Double(aspect),
            "pieces": pieces.map { piece in
                [
                    "text": piece.text,
                    "x": Double(piece.box.minX),
                    "y": Double(1 - piece.box.maxY),
                    "w": Double(piece.box.width),
                    "h": Double(piece.box.height),
                    "confidence": Double(piece.confidence),
                ] as [String: Any]
            },
        ]
    }
    var pages: [[String: Any]] = []
    if location.pathExtension.lowercased() == "pdf" {
        guard let document = openPDFDocument(location) else { fail("cannot read the PDF") }
        var anyTextOnAnyPage = false
        var rawPages: [(page: [String: Any], pieces: [Piece], scanned: Bool)] = []
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let layer = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if layer.count >= 20 {
                let pieces = textLayerLines(page).map { run in
                    Piece(
                        text: run.text,
                        box: CGRect(
                            x: (run.box.minX - bounds.minX) / bounds.width,
                            y: (run.box.minY - bounds.minY) / bounds.height,
                            width: run.box.width / bounds.width,
                            height: run.box.height / bounds.height),
                        confidence: 1.0
                    )
                }
                if !pieces.isEmpty { anyTextOnAnyPage = true }
                rawPages.append((place(pieces, index: index, aspect: bounds.width / bounds.height), pieces, false))
            } else if let image = pageImage(page) {
                let read = recognizePieces(image, split: true)
                if !read.isEmpty { anyTextOnAnyPage = true }
                let found = place(read, index: index, aspect: CGFloat(image.width) / CGFloat(image.height))
                rawPages.append((found, read, true))
            }
        }
        for item in rawPages {
            var found = item.page
            if item.scanned {
                // Report an empty page as unreadable only when the whole PDF had zero readable text.
                found.merge(legibility(item.pieces, height: nil, reportEmptyAsUnreadable: !anyTextOnAnyPage)) { $1 }
            }
            pages.append(found)
        }
    } else {
        guard let source = CGImageSourceCreateWithURL(location as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { fail("cannot read the image") }
        imageOrientation = orientation(of: source)
        let read = recognizePhoto(image, split: true)
        var found = place(read.pieces, index: 0, aspect: read.aspect)
        found.merge(legibility(read.pieces, height: read.height, reportEmptyAsUnreadable: true)) { $1 }
        pages.append(found)
    }
    let data = try! JSONSerialization.data(withJSONObject: ["pages": pages], options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

guard arguments.count == 1 else { fail(usage, 2) }
let url = URL(fileURLWithPath: arguments[0])

if url.pathExtension.lowercased() == "pdf" {
    guard let document = openPDFDocument(url) else { fail("cannot read the PDF") }
    for index in 0..<document.pageCount {
        guard let page = document.page(at: index) else { continue }
        let text = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count >= 20 {
            print(text)
            continue
        }
        // A scan has no text layer: draw the page and read it.
        if let image = pageImage(page) {
            recognize(image).forEach { print($0) }
        }
    }
} else {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { fail("cannot read the image") }
    imageOrientation = orientation(of: source)
    let read = recognizePhoto(image, split: false)
    rows(read.pieces).map { $0.sorted(by: { $0.box.minX < $1.box.minX }).map(\.text).joined(separator: " ") }
        .forEach { print($0) }
}
