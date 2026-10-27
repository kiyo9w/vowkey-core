// Prints the text of a document: the text layer of a PDF, and what Apple's Vision framework reads
// from an image or from a PDF page that has no text layer, one line per printed line. It also reads
// and fills PDF forms the way Preview does, through PDFKit.
// Usage:
//   vowkey-read FILE                 the document's text
//   vowkey-read --form FILE          the form's fields as JSON, each with the printed words naming it
//   vowkey-read --fill FILE OUT      writes OUT with the values read as JSON {field: value} on stdin
//   vowkey-read --front              the app in front and the file its window shows, as JSON

import AppKit
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
let usage = "usage: vowkey-read FILE | --form FILE | --fill FILE OUT"

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
    guard arguments.count == 2, let document = PDFDocument(url: URL(fileURLWithPath: arguments[1]))
    else { fail(usage, 2) }
    let found = widgets(document)
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
    var fields: [[String: Any]] = []
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
    let data = try! JSONSerialization.data(withJSONObject: ["fields": fields], options: [])
    FileHandle.standardOutput.write(data)
    exit(0)
}

if arguments.first == "--fill" {
    guard arguments.count == 3, let document = PDFDocument(url: URL(fileURLWithPath: arguments[1]))
    else { fail(usage, 2) }
    let input = FileHandle.standardInput.readDataToEndOfFile()
    guard let values = (try? JSONSerialization.jsonObject(with: input)) as? [String: String]
    else { fail("expected a JSON object of field values on stdin", 2) }
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
    guard document.write(to: URL(fileURLWithPath: arguments[2])) else { fail("cannot write the filled PDF") }
    print(filled.count)
    exit(0)
}

guard arguments.count == 1 else { fail(usage, 2) }
let url = URL(fileURLWithPath: arguments[0])

struct Piece {
    let text: String
    let box: CGRect
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

/// The pieces of text Vision reads, each with its box in normalized image coordinates.
func recognizePieces(_ image: CGImage) -> [Piece] {
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
            try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
        } catch {
            fail("text recognition failed: \(error)")
        }
        var score: Float = 0
        let pieces: [Piece] = (request.results ?? []).compactMap { observation in
            guard let top = observation.topCandidates(1).first else { return nil }
            score += top.confidence * Float(top.string.filter { !$0.isWhitespace }.count)
            return Piece(text: top.string, box: observation.boundingBox)
        }
        if score > best.score { best = (score, pieces) }
    }
    return best.pieces
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
    recognize(image).forEach { print($0) }
}
