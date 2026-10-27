// Prints the text of a document: the text layer of a PDF, and what Apple's Vision framework reads
// from an image or from a PDF page that has no text layer, one line per printed line.
// Usage: vowkey-read FILE

import Foundation
import ImageIO
import PDFKit
import Vision

func fail(_ message: String, _ code: Int32 = 1) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(code)
}

guard CommandLine.arguments.count == 2 else { fail("usage: vowkey-read FILE", 2) }
let url = URL(fileURLWithPath: CommandLine.arguments[1])

struct Piece {
    let text: String
    let box: CGRect
}

/// The text Vision reads from an image, top to bottom, with the pieces that share a line joined.
func recognize(_ image: CGImage) -> [String] {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    // Document numbers and machine-readable zones are not words, so a language model would damage them.
    request.usesLanguageCorrection = false
    let wanted = [
        "en-US", "ja-JP", "vi-VT", "ko-KR", "zh-Hans", "zh-Hant", "th-TH", "id-ID", "fr-FR",
        "de-DE", "es-ES", "it-IT", "pt-BR", "ru-RU", "uk-UA", "tr-TR", "pl-PL", "nl-NL",
    ]
    if let supported = try? request.supportedRecognitionLanguages() {
        let usable = wanted.filter { supported.contains($0) }
        if !usable.isEmpty { request.recognitionLanguages = usable }
    }
    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        fail("text recognition failed: \(error)")
    }
    let pieces: [Piece] = (request.results ?? []).compactMap { observation in
        guard let best = observation.topCandidates(1).first else { return nil }
        return Piece(text: best.string, box: observation.boundingBox)
    }
    // Vision's origin is the bottom left.
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
    return rows.map { $0.sorted(by: { $0.box.minX < $1.box.minX }).map(\.text).joined(separator: " ") }
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
        let bounds = page.bounds(for: .mediaBox)
        let scale = 2200 / max(bounds.width, bounds.height)
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        let thumbnail = page.thumbnail(of: size, for: .mediaBox)
        var rect = CGRect(origin: .zero, size: thumbnail.size)
        if let image = thumbnail.cgImage(forProposedRect: &rect, context: nil, hints: nil) {
            recognize(image).forEach { print($0) }
        }
    }
} else {
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else { fail("cannot read the image") }
    recognize(image).forEach { print($0) }
}
