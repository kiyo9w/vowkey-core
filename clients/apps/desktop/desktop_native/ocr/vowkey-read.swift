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

let usage = "usage: vowkey-read FILE | --pieces FILE | --form FILE | --fill FILE OUT"

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
    let band = max(6, box.height * 0.7)
    var above: (CGFloat, String)?
    var left: (CGFloat, String)?
    for line in lines {
        let r = line.box
        if r.minY >= box.maxY - 2, r.minY <= box.maxY + 26, r.maxX >= box.minX - 4, r.minX <= box.maxX + 4 {
            let d = r.minY - box.maxY
            if above == nil || d < above!.0 { above = (d, line.text) }
        }
        if abs(r.midY - box.midY) <= band, r.maxX <= box.minX + 4, box.minX - r.maxX <= 220 {
            let d = box.minX - r.maxX
            if left == nil || d < left!.0 { left = (d, line.text) }
        }
    }
    switch (above, left) {
    case let (a?, l?): return a.0 < l.0 ? a.1 : l.1
    case let (a?, nil): return a.1
    case let (nil, l?): return l.1
    default: return ""
    }
}

struct SubSlot {
    let x: CGFloat
    let w: CGFloat
}

struct Piece {
    let text: String
    let box: CGRect
    /// How sure text recognition was of the line the piece is from, 0 to 1.
    var confidence: Float = 1
    /// Pre-split sub-slots when a printed leader line carries `/` or `-` date dividers.
    var leaderSlots: [SubSlot]? = nil
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
                if v < bg - 20 {
                    darkCount += 1
                }
            }
            if darkCount >= samples - 2 {
                if let last = walls.last, xNorm - last < 0.011 {
                    px += 1
                    continue
                }
                walls.append(xNorm)
                px += max(2, Int(0.009 * CGFloat(width)))
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

    private func hasHorizontalRule(from x0Norm: CGFloat, to x1Norm: CGFloat, yLow: CGFloat, yHigh: CGFloat) -> CGFloat? {
        guard x1Norm - x0Norm >= 0.06, yHigh > yLow else { return nil }
        let px0 = max(0, min(width - 1, Int(x0Norm * CGFloat(width - 1))))
        let px1 = max(0, min(width - 1, Int(x1Norm * CGFloat(width - 1))))
        guard px1 - px0 >= 16 else { return nil }
        let pyTop = max(0, min(height - 1, Int((1.0 - yHigh) * CGFloat(height - 1))))
        let pyBot = max(0, min(height - 1, Int((1.0 - yLow) * CGFloat(height - 1))))
        guard pyBot >= pyTop else { return nil }
        let bgY = min(0.99, yHigh + 0.008)
        let bg = max(lum(x0Norm, bgY), lum((x0Norm + x1Norm) * 0.5, bgY))
        for py in pyTop...pyBot {
            var hits = 0
            var total = 0
            for px in stride(from: px0, through: px1, by: 2) {
                total += 1
                if Int(pixels[py * width + px]) < bg - 28 {
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
    func overlinedWritingSlot(for labelBox: CGRect, rightBound: CGFloat, pieces: [Piece]) -> CGRect? {
        guard labelBox.height <= 0.020, labelBox.width <= 0.20 else { return nil }
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
        let checkRect = candidate.insetBy(dx: 0.004, dy: 0.002)
        guard pieces.allSatisfy({ !$0.box.intersects(checkRect) }) else { return nil }
        return candidate
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
    if t == "年" || t == "Year" || t == "年 (Year)" { return "Y" }
    if t == "月" || t == "Month" || t == "月 (Month)" { return "M" }
    if t == "日" || t == "Day" || t == "日 (Day)" { return "D" }
    if t == "/" || t == "／" { return "/" }
    return nil
}

func visualWidth(_ s: Substring) -> CGFloat {
    var w: CGFloat = 0
    for ch in s {
        if ch == "\u{2026}" {
            w += 2.6
        } else if ch.unicodeScalars.contains(where: { $0.value >= 0x3000 }) {
            w += 1.8
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
        of: #"(?:\([0-9a-zA-Z]*\)|[®©™"'])+[\s:：\.…_＿・\-ー/／]*$"#,
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
    guard !cleaned.isEmpty, cleaned.count <= 68 else { return false }
    guard cleaned.contains(where: { $0.isLetter }) else { return false }
    guard !valueCellUnits.contains(cleaned), dateDelimiterRole(cleaned) == nil else { return false }
    if piece.box.width > 0.54 && leaderRatio == nil { return false }
    if cleaned.hasSuffix("。") || cleaned.hasSuffix("ください") || cleaned.hasSuffix("ます") {
        return false
    }
    return true
}

/// Merges 2-line bilingual labels (a CJK line directly above an English translation subtitle at the
/// same left margin, as on Japanese ISA/MOJ and Korean government forms) into a single combined label
/// anchored at the lower baseline so only one fill slot is emitted per field.
func mergeBilingualSubtitles(_ pieces: [Piece]) -> [Piece] {
    var used = Set<Int>()
    var out: [Piece] = []
    for (i, top) in pieces.enumerated() {
        if used.contains(i) { continue }
        let hasCJK = top.text.unicodeScalars.contains { $0.value >= 0x3000 }
        if hasCJK {
            var bestSub: Int? = nil
            var bestGap: CGFloat = 1.0
            for (j, sub) in pieces.enumerated() where j != i && !used.contains(j) {
                let isASCII = sub.text.unicodeScalars.allSatisfy { $0.value < 0x0250 }
                let hasAlpha = sub.text.contains { $0.isLetter }
                guard isASCII && hasAlpha else { continue }
                let dy = top.box.minY - sub.box.maxY
                let dx = abs(top.box.minX - sub.box.minX)
                if dy >= -0.008 && dy <= 0.014 && dx <= 0.06 && sub.box.width <= max(top.box.width * 2.5, 0.28) {
                    if dy < bestGap {
                        bestGap = dy
                        bestSub = j
                    }
                }
            }
            if let j = bestSub {
                let sub = pieces[j]
                used.insert(j)
                let minX = min(top.box.minX, sub.box.minX)
                let maxX = max(top.box.maxX, sub.box.maxX)
                out.append(
                    Piece(
                        text: "\(top.text) (\(sub.text))",
                        box: CGRect(
                            x: minX,
                            y: sub.box.minY,
                            width: maxX - minX,
                            height: max(top.box.height, sub.box.height)
                        ),
                        confidence: min(top.confidence, sub.confidence),
                        leaderSlots: top.leaderSlots ?? sub.leaderSlots
                    )
                )
                continue
            }
        }
        out.append(top)
    }
    return out
}

/// Computes date sub-slots when printed `年 / 月 / 日` or `/` tokens stand on the row inside `[startX .. endX]`.
func rowDateSubSlots(row: [Piece], startX: CGFloat, endX: CGFloat) -> [SubSlot]? {
    let tokens = row
        .compactMap { p -> (role: String, box: CGRect)? in
            let lbl = cleanFormLabel(p.text).label
            let role = dateDelimiterRole(p.text) ?? dateDelimiterRole(lbl)
            guard let role, p.box.minX > startX + 0.02, p.box.minX < endX + 0.03 else { return nil }
            return (role, p.box)
        }
        .sorted { $0.box.minX < $1.box.minX }

    let ymd = tokens.filter { $0.role == "Y" || $0.role == "M" || $0.role == "D" }
    if ymd.count == 3, ymd[0].role == "Y", ymd[1].role == "M", ymd[2].role == "D" {
        let pad: CGFloat = 0.004
        let s1 = SubSlot(x: startX, w: ymd[0].box.minX - pad - startX)
        let s2 = SubSlot(x: ymd[0].box.maxX + pad, w: ymd[1].box.minX - pad - (ymd[0].box.maxX + pad))
        let s3 = SubSlot(x: ymd[1].box.maxX + pad, w: ymd[2].box.minX - pad - (ymd[1].box.maxX + pad))
        if s1.w >= 0.032, s2.w >= 0.025, s3.w >= 0.025 {
            return [s1, s2, s3]
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

/// Detects fillable slots on a flat PDF page or photographed paper form from its printed labels.
func visualFormFields(_ rawPieces: [Piece], pageIndex: Int, image: CGImage? = nil) -> [[String: Any]] {
    let pieces = mergeBilingualSubtitles(splitLeaderPieces(rawPieces))
    guard !pieces.isEmpty else { return [] }
    let gray = image.flatMap { GrayBitmap($0) }
    let lineRows = rows(pieces).map { $0.sorted(by: { $0.box.minX < $1.box.minX }) }
    let formRight = min(0.94, max(0.86, pieces.map(\.box.maxX).max() ?? 0.90))
    var fields: [[String: Any]] = []
    var seenKeys = Set<String>()

    for (rowIndex, row) in lineRows.enumerated() {
        let nonUnits = row.filter {
            let lbl = cleanFormLabel($0.text).label
            return lbl.contains(where: { $0.isLetter })
                && !valueCellUnits.contains(lbl)
                && dateDelimiterRole($0.text) == nil
                && dateDelimiterRole(lbl) == nil
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
            let startsWithCheckbox = rawTrimmed.range(of: #"^(?:[□☐☑✓]|口\s)"#, options: .regularExpression) != nil
            let precededByCheckbox = row.contains { other in
                let t = other.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard t == "□" || t == "☐" || t == "☑" || t == "✓" || t == "口" else { return false }
                let gap = piece.box.minX - other.box.maxX
                return gap >= -0.005 && gap <= 0.028
            }
            if startsWithCheckbox || precededByCheckbox { continue }
            if gray?.hasLeadingCheckboxOutline(before: piece.box) == true { continue }

            let (cleaned, leaderRatio) = cleanFormLabel(piece.text)
            guard isCandidateFormLabel(cleaned, piece: piece, leaderRatio: leaderRatio) else { continue }
            let nextPiece = (idx + 1 < nonUnits.count) ? nonUnits[idx + 1] : nil
            let rightBound = (nextPiece != nil) ? (nextPiece!.box.minX - 0.012) : formRight

            var slot: CGRect? = nil
            var combCells: Int? = nil
            var dateSlots: [SubSlot]? = nil

            if let ratio = leaderRatio {
                let startX = piece.box.minX + piece.box.width * min(0.68, max(0.16, ratio + 0.03))
                let endX = max(piece.box.maxX, rightBound)
                if endX - startX >= 0.07 {
                    slot = CGRect(
                        x: startX,
                        y: piece.box.minY + piece.box.height * 0.04,
                        width: endX - startX,
                        height: max(piece.box.height * 1.25, 0.022)
                    )
                }
            } else if let overlined = gray?.overlinedWritingSlot(for: piece.box, rightBound: rightBound, pieces: pieces) {
                slot = overlined
            } else {
                var startX = piece.box.maxX + 0.015
                var customEndX = rightBound
                let allWalls = gray?.verticalWalls(
                    from: piece.box.maxX + 0.004,
                    to: min(0.95, rightBound + 0.02),
                    midY: piece.box.midY,
                    rowH: piece.box.height,
                    ignoring: rowTextBoxes
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
                    let hasColon = piece.text.trimmingCharacters(in: .whitespaces).hasSuffix(":")
                        || piece.text.trimmingCharacters(in: .whitespaces).hasSuffix("：")
                    let stackedBelow = !hasColon
                        && nextRowMaxY >= 0
                        && verticalGap >= rowHeight * 1.25
                        && verticalGap <= rowHeight * 4.5
                        && rightWidth < 0.14
                    let minRightWidth: CGFloat = hasColon ? 0.052 : 0.085
                    if !stackedBelow && rightWidth >= minRightWidth {
                        slot = CGRect(
                            x: startX,
                            y: piece.box.minY - piece.box.height * 0.06,
                            width: rightWidth,
                            height: max(piece.box.height * 1.3, 0.022)
                        )
                    } else {
                        let belowH = max(piece.box.height * 1.3, 0.022)
                        let belowY = piece.box.minY - belowH * 1.15
                        let belowW = max(piece.box.width, min(0.32, rightBound - piece.box.minX))
                        let belowRect = CGRect(x: piece.box.minX, y: belowY, width: belowW, height: belowH)
                        if belowY > 0.03, pieces.allSatisfy({ !$0.box.intersects(belowRect.insetBy(dx: 0.004, dy: 0.004)) }) {
                            slot = belowRect
                        } else if rightWidth >= 0.065 {
                            slot = CGRect(
                                x: startX,
                                y: piece.box.minY - piece.box.height * 0.06,
                                width: rightWidth,
                                height: max(piece.box.height * 1.3, 0.022)
                            )
                        }
                    }
                }
            }

            guard let box = slot else { continue }
            if combCells == nil {
                if let explicitRowSlots = rowDateSubSlots(row: row, startX: box.minX, endX: box.maxX) {
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
            if let cells = combCells {
                key += ":comb:\(cells)"
            } else if let dSlots = dateSlots, !dSlots.isEmpty {
                let encoded = dSlots.map { String(format: "%.4f,%.4f", $0.x, $0.w) }.joined(separator: ";")
                key += ":slots:\(encoded)"
            }
            guard !seenKeys.contains(key) else { continue }
            seenKeys.insert(key)
            var entry: [String: Any] = [
                "key": key,
                "name": "",
                "tooltip": "",
                "label": cleaned,
                "type": "text",
                "maxLength": 0,
                "options": [] as [String],
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

func parseBoxKey(_ key: String) -> (page: Int, rect: CGRect, comb: Int?, slots: [SubSlot]?)? {
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
    }
    return (page, CGRect(x: x, y: y, width: w, height: h), comb, slots)
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
    guard parts.count == slots.count else { return nil }
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

if arguments.first == "--form" {
    guard arguments.count == 2 else { fail(usage, 2) }
    let formURL = URL(fileURLWithPath: arguments[1])
    var fields: [[String: Any]] = []
    if formURL.pathExtension.lowercased() == "pdf" {
        guard let document = PDFDocument(url: formURL) else { fail(usage, 2) }
        let found = widgets(document)
        if !found.isEmpty {
            // A page whose text layer does not say what the page shows (a font with no Unicode mapping, or
            // a scan) is named from what text recognition reads on it, as Preview does.
            func letters(_ lines: [Line]) -> Set<Character> {
                Set(lines.flatMap { $0.text }.filter { $0.isLetter })
            }
            var labels: [Int: [String]] = [:]
            for pageIndex in Set(found.map(\.pageIndex)) {
                guard let page = document.page(at: pageIndex) else { continue }
                let boxes = found.filter { $0.pageIndex == pageIndex }.map(\.widget.bounds)
                let printed = textLayerLines(page)
                let seen = recognizedLines(page)
                let read = letters(seen)
                let agree = read.isEmpty ? 1 : Double(letters(printed).intersection(read).count) / Double(read.count)
                let lines = agree >= 0.5 ? printed : seen
                labels[pageIndex] = boxes.map { labelNear(lines, $0) }
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
        guard let document = PDFDocument(url: sourceURL) else { fail(usage, 2) }
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
        guard let document = PDFDocument(url: location) else { fail("cannot read the PDF") }
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
    guard let document = PDFDocument(url: url) else { fail("cannot read the PDF") }
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
