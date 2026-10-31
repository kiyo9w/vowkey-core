// Prints the text of a document: the text layer of a PDF, and what Apple's Vision framework reads
// from an image or from a PDF page that has no text layer, one line per printed line. It also reads
// and fills PDF forms the way Preview does, through PDFKit.
// Usage:
//   vowkey-read FILE                 the document's text
//   vowkey-read --pieces FILE        the printed pieces of each page as JSON, each with its place on the page
//   vowkey-read --form FILE          the form's fields as JSON, each with the printed words naming it
//   vowkey-read --fill FILE OUT      writes OUT with the values read as JSON {field: value} on stdin
//   vowkey-read --front              the app in front and the file its window shows, as JSON

import AppKit
import CoreImage
import CoreImage.CIFilterBuiltins
import ApplicationServices
import Foundation
import ImageIO
import PDFKit
import Vision

func fail(_ message: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

let arguments = Array(CommandLine.arguments.dropFirst())

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

struct Piece {
    let text: String
    let box: CGRect
    /// How sure text recognition was of the line the piece is from, 0 to 1.
    var confidence: Float = 1
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

/// One reading of a picture: the pieces and how sure the model was of them.
func recognizeScale(_ image: CGImage, split: Bool) -> (score: Float, pieces: [Piece]) {
    // Vision reads with the model of the first language it is given: Latin text through a
    // Japanese model comes out fine, but Japanese, Chinese or Korean through a Latin model comes out
    // as noise. Each script's model reads the page, and the reading it is surest of is kept.
    let latin = [
        "en-US", "vi-VT", "fr-FR", "de-DE", "es-ES", "it-IT", "pt-BR", "id-ID", "tr-TR", "pl-PL",
        "nl-NL", "ru-RU", "uk-UA", "th-TH",
    ]
    let passes = [latin, ["ja-JP", "en-US"], ["zh-Hans", "zh-Hant", "en-US"], ["ko-KR", "en-US"]]
    var best: (score: Float, pieces: [Piece]) = (-1, [])
    for languages in passes {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        // Document numbers and machine-readable zones are not words, so a language model would damage them.
        request.usesLanguageCorrection = false
        if let supported = try? request.supportedRecognitionLanguages() {
            let usable = languages.filter { supported.contains($0) }
            if usable.isEmpty { continue }
            request.recognitionLanguages = usable
        }
        do {
            try VNImageRequestHandler(cgImage: image, orientation: imageOrientation, options: [:]).perform([request])
        } catch {
            fail("text recognition failed: \(error)")
        }
        var score: Float = 0
        let pieces: [Piece] = (request.results ?? []).flatMap { observation -> [Piece] in
            guard let top = observation.topCandidates(1).first else { return [] }
            let noiseCount = top.string.filter { "#*÷•=+][".contains($0) }.count
            let weight: Float = top.string.reduce(0) { sum, ch in
                guard ch.isLetter || ch.isNumber else { return sum }
                let scalar = ch.unicodeScalars.first?.value ?? 0
                let isCjk = (0x3040...0x30FF).contains(scalar)
                    || (0x3400...0x9FFF).contains(scalar)
                    || (0xAC00...0xD7AF).contains(scalar)
                return sum + (isCjk ? 3.2 : 1.0)
            }
            score += top.confidence * max(0, weight - Float(noiseCount) * 4.0)
            let whole = Piece(text: top.string, box: observation.boundingBox, confidence: top.confidence)
            return split ? runs(of: top, whole: whole, image: image) : [whole]
        }
        if score > best.score { best = (score, pieces) }
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

/// A picture read at its own size and, when it is small, again at twice the size; the reading
/// that the model is surer of is kept.
func recognizeBest(_ image: CGImage, split: Bool) -> (score: Float, pieces: [Piece]) {
    var best = recognizeScale(image, split: split)
    if min(image.width, image.height) < 1100, let larger = upscaled(image, by: 2) {
        let again = recognizeScale(larger, split: split)
        if again.score > best.score { best = again }
    }
    return best
}

/// The pieces of text Vision reads from a page, each with its box in normalized image coordinates.
/// With `split`, a line that crosses cells comes back as one piece for each cell.
func recognizePieces(_ image: CGImage, split: Bool = false) -> [Piece] {
    recognizeBest(image, split: split).pieces
}

/// The page of a photo straightened: found as the document in the picture and drawn square on, so a
/// card held at an angle reads in straight rows. Nil when no page is found.
func rectified(_ image: CGImage) -> CGImage? {
    let request = VNDetectDocumentSegmentationRequest()
    let handler = VNImageRequestHandler(cgImage: image, orientation: imageOrientation, options: [:])
    guard (try? handler.perform([request])) != nil, let found = request.results?.first, found.confidence > 0.6
    else { return nil }
    let corners = [found.topLeft, found.topRight, found.bottomRight, found.bottomLeft]
    let area = abs(
        zip(corners, corners.dropFirst() + [corners[0]]).reduce(CGFloat(0)) { $0 + $1.0.x * $1.1.y - $1.1.x * $1.0.y }) / 2
    guard area > 0.3 else { return nil }
    var oriented = CIImage(cgImage: image).oriented(imageOrientation)
    oriented = oriented.transformed(by: CGAffineTransform(translationX: -oriented.extent.minX, y: -oriented.extent.minY))
    let size = oriented.extent.size
    func point(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * size.width, y: p.y * size.height) }
    let filter = CIFilter.perspectiveCorrection()
    filter.inputImage = oriented
    filter.topLeft = point(found.topLeft)
    filter.topRight = point(found.topRight)
    filter.bottomLeft = point(found.bottomLeft)
    filter.bottomRight = point(found.bottomRight)
    guard let output = filter.outputImage else { return nil }
    return CIContext().createCGImage(output, from: output.extent)
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
        if again.score > best.score { best = (again.score, again.pieces, size.width / size.height, size.height) }
    }
    imageOrientation = original
    return (best.pieces, best.aspect, best.height)
}

/// How well a picture read: the share of its printed characters that text recognition was unsure
/// of, and, given the picture's height in pixels, how tall its middle line was. A page whose print
/// is a few pixels tall cannot be read, however it is enlarged.
func legibility(_ pieces: [Piece], height: CGFloat?) -> [String: Double] {
    let characters = pieces.reduce(0) { $0 + $1.text.filter { !$0.isWhitespace }.count }
    guard characters > 0 else { return [:] }
    let unsure = pieces.filter { $0.confidence < 0.5 }.reduce(0) { $0 + $1.text.filter { !$0.isWhitespace }.count }
    var found = ["unsure": Double(unsure) / Double(characters)]
    if let height {
        let lines = pieces.map { $0.box.height }.sorted()
        found["lineHeight"] = Double(lines[lines.count / 2] * height)
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
        let w = min(image.width, 1000)
        let h = min(image.height, 1400)
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

    /// Finds all vertical cell border lines to the right of a label on the same row.
    func verticalWalls(from startX: CGFloat, to endX: CGFloat, midY: CGFloat, rowH: CGFloat) -> [CGFloat] {
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
            let bg = max(lum(max(0, xNorm - 0.008), midY), lum(min(1, xNorm + 0.008), midY))
            var darkCount = 0
            for s in 0..<samples {
                let y = yBot + (yTop - yBot) * CGFloat(s) / CGFloat(samples - 1)
                let v = min(lum(xNorm, y), min(lum(xNorm - 0.001, y), lum(xNorm + 0.001, y)))
                if v < bg - 25 {
                    darkCount += 1
                }
            }
            if darkCount >= samples - 2 {
                if let last = walls.last, xNorm - last < 0.012 {
                    px += 1
                    continue
                }
                walls.append(xNorm)
                px += max(2, Int(0.010 * CGFloat(width)))
            } else {
                px += 1
            }
        }
        return walls
    }

    /// Finds the first vertical cell border line to the right of a label on the same row.
    func verticalWall(from startX: CGFloat, to endX: CGFloat, midY: CGFloat, rowH: CGFloat) -> CGFloat? {
        verticalWalls(from: startX, to: endX, midY: midY, rowH: rowH).first
    }
}

let valueCellUnits: Set<String> = [
    "年", "月", "日", "歳", "才", "男", "女", "有", "無", "令和", "平成", "昭和", "西暦",
    "印", "殿", "様", "〒", "-", "ー", "/", "／", "・", "(", ")", "（", "）", "☐", "□", "✓",
]

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

/// Splits a line that has one or more dotted/underscored fill leaders into separate label pieces,
/// leaving the leader spans as empty horizontal space to be filled.
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
                let x = piece.box.minX + piece.box.width * startOff
                let w = max(0.03, piece.box.width * (endOff - startOff))
                result.append(
                    Piece(
                        text: prefix,
                        box: CGRect(x: x, y: piece.box.minY, width: w, height: piece.box.height),
                        confidence: piece.confidence
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
        of: #"^[\s\.…_＿・\-ー/／:：]+"#,
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
    guard !valueCellUnits.contains(cleaned) else { return false }
    if piece.box.width > 0.68 && leaderRatio == nil { return false }
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
                        confidence: min(top.confidence, sub.confidence)
                    )
                )
                continue
            }
        }
        out.append(top)
    }
    return out
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
            return lbl.contains(where: { $0.isLetter }) && !valueCellUnits.contains(lbl)
        }
        guard !nonUnits.isEmpty else { continue }
        let rowMinY = row.map(\.box.minY).min() ?? 0
        let rowHeight = max(row.map(\.box.height).max() ?? 0.02, 0.016)
        let nextRowMaxY = (rowIndex + 1 < lineRows.count)
            ? (lineRows[rowIndex + 1].map(\.box.maxY).max() ?? 0)
            : -1
        let verticalGap = nextRowMaxY >= 0 ? (rowMinY - nextRowMaxY) : 0

        for (idx, piece) in nonUnits.enumerated() {
            let (cleaned, leaderRatio) = cleanFormLabel(piece.text)
            guard isCandidateFormLabel(cleaned, piece: piece, leaderRatio: leaderRatio) else { continue }
            let nextPiece = (idx + 1 < nonUnits.count) ? nonUnits[idx + 1] : nil
            let rightBound = (nextPiece != nil) ? (nextPiece!.box.minX - 0.012) : formRight

            var slot: CGRect? = nil
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
            } else {
                var startX = piece.box.maxX + 0.015
                var customEndX = rightBound
                let allWalls = gray?.verticalWalls(
                    from: piece.box.maxX + 0.004,
                    to: min(0.95, rightBound + 0.02),
                    midY: piece.box.midY,
                    rowH: piece.box.height
                ) ?? []
                if allWalls.count >= 6 {
                    startX = allWalls.first!
                    customEndX = allWalls.last!
                } else if let wallX = allWalls.first, wallX < min(rightBound - 0.08, piece.box.maxX + 0.28) {
                    startX = wallX + 0.014
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

            guard let box = slot else { continue }
            let key = String(
                format: "box:%d:%.4f:%.4f:%.4f:%.4f",
                pageIndex, box.minX, box.minY, box.width, box.height
            )
            guard !seenKeys.contains(key) else { continue }
            seenKeys.insert(key)
            fields.append([
                "key": key,
                "name": "",
                "tooltip": "",
                "label": cleaned,
                "type": "text",
                "maxLength": 0,
                "options": [] as [String],
            ])
        }
    }
    return fields
}

func parseBoxKey(_ key: String) -> (page: Int, rect: CGRect, comb: Int?)? {
    let parts = key.split(separator: ":")
    guard parts.count >= 6, parts[0] == "box",
        let page = Int(parts[1]),
        let x = Double(parts[2]),
        let y = Double(parts[3]),
        let w = Double(parts[4]),
        let h = Double(parts[5])
    else { return nil }
    var comb: Int? = nil
    if parts.count >= 8, parts[6] == "comb", let cells = Int(parts[7]), cells > 1 {
        comb = cells
    }
    return (page, CGRect(x: x, y: y, width: w, height: h), comb)
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
    let image = orientedCGImage(rawImage, orientation(of: source))
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
    func localPaperColor(around box: CGRect) -> NSColor {
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
        return NSColor(calibratedRed: bestR, green: bestG, blue: bestB, alpha: 0.78)
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
            let chars = Array(trimmed)
            let cellW = box.width / CGFloat(cells)
            let fontSize = min(max(13, box.height * 0.64), cellW * 0.78, 28)
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
                let cellBacking = NSBezierPath(
                    roundedRect: CGRect(x: drawX - 2, y: drawY, width: m.width + 4, height: m.height),
                    xRadius: 2,
                    yRadius: 2
                )
                backingColor.setFill()
                cellBacking.fill()
                s.draw(at: NSPoint(x: drawX, y: drawY), withAttributes: attrs)
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
        let image = orientedCGImage(rawImage, orientation(of: source))
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
            let charCount = max(CGFloat(trimmed.count), 1)
            let fontSize = min(
                max(9, min(rect.height * 0.62, 18)),
                max(8, (rect.width * 0.92) / max(charCount * 0.62, 1))
            )
            let annotation = PDFAnnotation(bounds: rect, forType: .freeText, withProperties: nil)
            annotation.contents = trimmed
            annotation.font = fillFont(size: fontSize)
            annotation.fontColor = inkColor
            annotation.color = .clear
            let border = PDFBorder()
            border.lineWidth = 0
            annotation.border = border
            page.addAnnotation(annotation)
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
    func place(_ pieces: [(box: CGRect, text: String)], index: Int, aspect: CGFloat) -> [String: Any] {
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
                ] as [String: Any]
            },
        ]
    }
    var pages: [[String: Any]] = []
    if location.pathExtension.lowercased() == "pdf" {
        guard let document = PDFDocument(url: location) else { fail("cannot read the PDF") }
        for index in 0..<document.pageCount {
            guard let page = document.page(at: index) else { continue }
            let bounds = page.bounds(for: .mediaBox)
            let layer = (page.string ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if layer.count >= 20 {
                let pieces = textLayerLines(page).map { run in
                    (
                        box: CGRect(
                            x: (run.box.minX - bounds.minX) / bounds.width,
                            y: (run.box.minY - bounds.minY) / bounds.height,
                            width: run.box.width / bounds.width,
                            height: run.box.height / bounds.height),
                        text: run.text
                    )
                }
                pages.append(place(pieces, index: index, aspect: bounds.width / bounds.height))
            } else if let image = pageImage(page) {
                let read = recognizePieces(image, split: true)
                var found = place(read.map { (box: $0.box, text: $0.text) }, index: index, aspect: CGFloat(image.width) / CGFloat(image.height))
                // The page is drawn at a size of its own choosing, so only the share read unsure says anything.
                found.merge(legibility(read, height: nil)) { $1 }
                pages.append(found)
            }
        }
    } else {
        guard let source = CGImageSourceCreateWithURL(location as CFURL, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { fail("cannot read the image") }
        imageOrientation = orientation(of: source)
        let read = recognizePhoto(image, split: true)
        var found = place(read.pieces.map { (box: $0.box, text: $0.text) }, index: 0, aspect: read.aspect)
        found.merge(legibility(read.pieces, height: read.height)) { $1 }
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
