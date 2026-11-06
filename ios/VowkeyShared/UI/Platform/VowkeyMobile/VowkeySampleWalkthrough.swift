import Foundation
import SwiftUI
import UIKit
import VowkeyKit
import VowkeyResources
import VowkeySdk

// MARK: - VowkeySampleScenario

struct VowkeySamplePrintedField: Identifiable {
    let key: String
    let attribute: String
    let printedLabel: String
    let value: String
    let script: String?
    let origin: String
    let verified: Bool
    let agentRule: String
    let practiceFillValue: String
    let practiceFieldLabel: String

    var id: String { key }
}

struct VowkeySampleScenario: Identifiable {
    let id: String
    let pickerLabel: String
    let profileName: String
    let fileName: String
    let documentKind: String
    let headerHex: UInt32
    let headerAuthority: String
    let headerSubtitle: String
    let footerLine1: String
    let footerLine2: String
    let documentDate: String
    let expiresOn: String
    let practiceFormTitle: String
    let practiceFormSubtitle: String
    let humanFieldLabel: String
    let humanFieldPlaceholder: String
    let fields: [VowkeySamplePrintedField]
}

// MARK: - VowkeySampleWalkthrough

enum VowkeySampleWalkthrough {
    static let sampleAttachmentPrefix = "sample:"
    static let cardWidth: CGFloat = 960
    static let cardHeight: CGFloat = 640

    static let scenarios: [VowkeySampleScenario] = [
        VowkeySampleScenario(
            id: "passport",
            pickerLabel: "Passport",
            profileName: "Åsamund Østenbyen (Sample)",
            fileName: "Passport-sample.png",
            documentKind: "Passport (sample)",
            headerHex: 0x1E3A8A,
            headerAuthority: "SAMPLE PASSAGE DOCUMENT · PASSPORT",
            headerSubtitle: "NOR · OFFICIAL SAMPLE — NOT VALID FOR TRAVEL",
            footerLine1: "P<NOROESTENBYEN<<AASAMUND<<<<<<<<<<<<<<<<<<",
            footerLine2: "CCC0022514NOR5604230M3004157<<<<<<<<<<<<<<04",
            documentDate: "2020-04-15",
            expiresOn: "2030-04-15",
            practiceFormTitle: "International passenger check-in",
            practiceFormSubtitle: "Practice form · Values stay on this device",
            humanFieldLabel: "Seat & meal note",
            humanFieldPlaceholder: "e.g. Window · 14A",
            fields: [
                VowkeySamplePrintedField(
                    key: "family",
                    attribute: "name.family",
                    printedLabel: "SURNAME / EFTERNAVN",
                    value: "Østenbyen",
                    script: nil,
                    origin: "mrz",
                    verified: true,
                    agentRule: "fill",
                    practiceFillValue: "ØSTENBYEN",
                    practiceFieldLabel: "Surname",
                ),
                VowkeySamplePrintedField(
                    key: "given",
                    attribute: "name.given",
                    printedLabel: "GIVEN NAMES / FORNAVN",
                    value: "Åsamund",
                    script: nil,
                    origin: "mrz",
                    verified: true,
                    agentRule: "fill",
                    practiceFillValue: "AASAMUND",
                    practiceFieldLabel: "Given names",
                ),
                VowkeySamplePrintedField(
                    key: "dob",
                    attribute: "birth.date",
                    printedLabel: "DATE OF BIRTH",
                    value: "1956-04-23",
                    script: nil,
                    origin: "mrz",
                    verified: true,
                    agentRule: "fill",
                    practiceFillValue: "23/04/1956",
                    practiceFieldLabel: "Date of birth (DD/MM/YYYY)",
                ),
                VowkeySamplePrintedField(
                    key: "nationality",
                    attribute: "person.nationality",
                    printedLabel: "NATIONALITY",
                    value: "Norwegian",
                    script: nil,
                    origin: "mrz",
                    verified: true,
                    agentRule: "fill",
                    practiceFillValue: "Norway",
                    practiceFieldLabel: "Nationality",
                ),
                VowkeySamplePrintedField(
                    key: "docno",
                    attribute: "id.passport.number",
                    printedLabel: "PASSPORT NO.",
                    value: "CCC002251",
                    script: nil,
                    origin: "mrz",
                    verified: true,
                    agentRule: "ask",
                    practiceFillValue: "CCC002251",
                    practiceFieldLabel: "Passport number",
                ),
                VowkeySamplePrintedField(
                    key: "expiry",
                    attribute: "id.passport.expiry",
                    printedLabel: "DATE OF EXPIRY",
                    value: "2030-04-15",
                    script: nil,
                    origin: "mrz",
                    verified: true,
                    agentRule: "fill",
                    practiceFillValue: "15/04/2030",
                    practiceFieldLabel: "Passport expiry (DD/MM/YYYY)",
                ),
            ],
        ),
        VowkeySampleScenario(
            id: "idcard",
            pickerLabel: "National ID",
            profileName: "Erika Mustermann (Sample)",
            fileName: "National-ID-sample.png",
            documentKind: "National ID card (sample)",
            headerHex: 0x1F4E5F,
            headerAuthority: "PERSONALAUSWEIS · IDENTITY CARD",
            headerSubtitle: "DEU · MUSTER / SAMPLE CARD",
            footerLine1: "IDD<<LZ6311T471<<<<<<<<<<<<<<<",
            footerLine2: "8308126F3405018D<<<<<<<<<<<<<4",
            documentDate: "2024-05-02",
            expiresOn: "2034-05-01",
            practiceFormTitle: "Municipal residence registration",
            practiceFormSubtitle: "Practice form · Values stay on this device",
            humanFieldLabel: "Move-in date",
            humanFieldPlaceholder: "DD.MM.YYYY",
            fields: [
                VowkeySamplePrintedField(
                    key: "family",
                    attribute: "name.family",
                    printedLabel: "NAME / SURNAME",
                    value: "Mustermann",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "Mustermann",
                    practiceFieldLabel: "Family name",
                ),
                VowkeySamplePrintedField(
                    key: "given",
                    attribute: "name.given",
                    printedLabel: "VORNAMEN / GIVEN NAMES",
                    value: "Erika",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "Erika",
                    practiceFieldLabel: "Given name",
                ),
                VowkeySamplePrintedField(
                    key: "dob",
                    attribute: "birth.date",
                    printedLabel: "GEBURTSTAG / BIRTH DATE",
                    value: "1983-08-12",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "12.08.1983",
                    practiceFieldLabel: "Date of birth (DD.MM.YYYY)",
                ),
                VowkeySamplePrintedField(
                    key: "place",
                    attribute: "birth.place",
                    printedLabel: "GEBURTSORT / PLACE OF BIRTH",
                    value: "Berlin",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "Berlin",
                    practiceFieldLabel: "Place of birth",
                ),
                VowkeySamplePrintedField(
                    key: "docno",
                    attribute: "id.card.number",
                    printedLabel: "DOCUMENT NO.",
                    value: "LZ6311T47",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "ask",
                    practiceFillValue: "LZ6311T47",
                    practiceFieldLabel: "ID card number",
                ),
                VowkeySamplePrintedField(
                    key: "expiry",
                    attribute: "id.card.expiry",
                    printedLabel: "GÜLTIG BIS / EXPIRY",
                    value: "2034-05-01",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "01.05.2034",
                    practiceFieldLabel: "Expiry date (DD.MM.YYYY)",
                ),
            ],
        ),
        VowkeySampleScenario(
            id: "residence",
            pickerLabel: "Residence",
            profileName: "Nguyễn Thị Linh · 阮 氏玲 (Sample)",
            fileName: "Residence-card-sample.png",
            documentKind: "Residence card (sample)",
            headerHex: 0x1D4ED8,
            headerAuthority: "RESIDENCE CARD · 在留カード見本",
            headerSubtitle: "MULTI-SCRIPT SAMPLE — FOR WALKTHROUGH ONLY",
            footerLine1: "SAMPLE DOCUMENT · MULTI-SCRIPT PROFILE",
            footerLine2: "AB12345678CD · TOKYO SHINJUKU-KU",
            documentDate: "2024-04-01",
            expiresOn: "2029-04-01",
            practiceFormTitle: "Employee & bank onboarding",
            practiceFormSubtitle: "Practice form · Multi-script matching on this device",
            humanFieldLabel: "Preferred start date",
            humanFieldPlaceholder: "YYYY/MM/DD",
            fields: [
                VowkeySamplePrintedField(
                    key: "latin",
                    attribute: "name.full",
                    printedLabel: "NAME (LATIN)",
                    value: "NGUYEN THI LINH",
                    script: "Latn",
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "NGUYEN THI LINH",
                    practiceFieldLabel: "Full name (Latin)",
                ),
                VowkeySamplePrintedField(
                    key: "kanji",
                    attribute: "name.full",
                    printedLabel: "氏名（漢字）",
                    value: "阮 氏玲",
                    script: "Hani",
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "阮 氏玲",
                    practiceFieldLabel: "Name (Kanji)",
                ),
                VowkeySamplePrintedField(
                    key: "kana",
                    attribute: "name.full",
                    printedLabel: "フリガナ（KANA）",
                    value: "グエン ティ リン",
                    script: "Kana",
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "グエン ティ リン",
                    practiceFieldLabel: "Name (Katakana)",
                ),
                VowkeySamplePrintedField(
                    key: "dob",
                    attribute: "birth.date",
                    printedLabel: "生年月日 / BIRTH DATE",
                    value: "1998-03-14",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "1998/03/14",
                    practiceFieldLabel: "Date of birth (YYYY/MM/DD)",
                ),
                VowkeySamplePrintedField(
                    key: "docno",
                    attribute: "id.card.number",
                    printedLabel: "在留カード番号 / CARD NO.",
                    value: "AB12345678CD",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "ask",
                    practiceFillValue: "AB12345678CD",
                    practiceFieldLabel: "Residence card number",
                ),
                VowkeySamplePrintedField(
                    key: "address",
                    attribute: "address.full",
                    printedLabel: "住居地 / ADDRESS",
                    value: "東京都新宿区高田馬場 4-18-9-302",
                    script: nil,
                    origin: "ocr",
                    verified: false,
                    agentRule: "fill",
                    practiceFillValue: "東京都新宿区高田馬場 4-18-9-302",
                    practiceFieldLabel: "Current address",
                ),
            ],
        ),
    ]

    static func fieldBox(index: Int) -> (rect: CGRect, locator: [String: Any]) {
        let col = index % 2
        let row = index / 2
        let px: CGFloat = col == 0 ? 272 : 604
        let py: CGFloat = 148 + CGFloat(row) * 104
        let pw: CGFloat = 304
        let ph: CGFloat = 72
        let rect = CGRect(x: px, y: py, width: pw, height: ph)
        let locator: [String: Any] = [
            "kind": "page",
            "page": 0,
            "x": Double(px / cardWidth),
            "y": Double(py / cardHeight),
            "w": Double(pw / cardWidth),
            "h": Double(ph / cardHeight),
        ]
        return (rect, locator)
    }

    static func isSampleCipher(_ view: CipherView) -> Bool {
        if NativeProfile.sources(view).contains(where: { source in
            guard let att = source["attachmentId"] as? String else { return false }
            return att.hasPrefix(sampleAttachmentPrefix)
        }) {
            return true
        }
        return (view.fields ?? []).contains { $0.name == "vk.sample" && $0.value == "1" }
    }

    static func scenario(forId id: String) -> VowkeySampleScenario? {
        scenarios.first { $0.id == id }
    }

    static func scenario(for view: CipherView) -> VowkeySampleScenario? {
        for source in NativeProfile.sources(view) {
            if let att = source["attachmentId"] as? String,
               att.hasPrefix(sampleAttachmentPrefix) {
                let id = String(att.dropFirst(sampleAttachmentPrefix.count))
                if let match = scenarios.first(where: { $0.id == id }) {
                    return match
                }
            }
        }
        return nil
    }

    static func buildCipher(for spec: VowkeySampleScenario) throws -> CipherView {
        let profileId = UUID().uuidString.lowercased()
        let sourceId = "sample-source-\(spec.id)"
        let attachmentId = "\(sampleAttachmentPrefix)\(spec.id)"

        var detailsByAttr: [String: [String: Any]] = [:]
        var orderedAttrs: [String] = []

        for (index, field) in spec.fields.enumerated() {
            let box = fieldBox(index: index)
            let variantId = UUID().uuidString.lowercased()
            let variant: [String: Any] = [
                "id": variantId,
                "script": field.script as Any? ?? NSNull(),
                "tag": NSNull(),
                "value": field.value,
                "current": true,
                "sourceId": sourceId,
                "locator": box.locator,
                "verified": field.verified,
                "origin": field.origin,
            ]
            if var existing = detailsByAttr[field.attribute] {
                var variants = existing["variants"] as? [[String: Any]] ?? []
                variants.append(variant)
                existing["variants"] = variants
                detailsByAttr[field.attribute] = existing
            } else {
                orderedAttrs.append(field.attribute)
                detailsByAttr[field.attribute] = [
                    "id": UUID().uuidString.lowercased(),
                    "attribute": field.attribute,
                    "label": NativeProfile.displayLabel(for: field.attribute),
                    "valueType": field.attribute.contains("date") || field.attribute.contains("expiry") ? "date" : "text",
                    "chosenVariantId": variantId,
                    "agentRule": field.agentRule,
                    "variants": [variant],
                    "history": [],
                    "conflicts": [],
                ]
            }
        }

        let details = orderedAttrs.compactMap { detailsByAttr[$0] }
        let sources: [[String: Any]] = [[
            "id": sourceId,
            "attachmentId": attachmentId,
            "fileName": spec.fileName,
            "mediaType": "image/png",
            "kind": "document",
            "documentKind": VowkeyMobileTheme.displayName(spec.documentKind),
            "title": VowkeyMobileTheme.displayName(spec.documentKind),
            "documentDate": spec.documentDate,
            "effectiveOn": spec.documentDate,
            "capturedAt": AgentManagementDate.string(Date()),
            "expiresOn": spec.expiresOn,
            "status": "current",
        ]]
        let meta: [String: Any] = [
            "v": 1,
            "profileId": profileId,
            "kind": "person",
            "relationship": NSNull(),
            "status": "confirmed",
            "details": details,
            "sources": sources,
        ]
        var base = NativeCipher.make(type: .identity, name: spec.profileName, id: profileId)
        base = NativeCipher.replacing(
            base,
            fields: [FieldView(name: "vk.sample", value: "1", type: .hidden, linkedId: nil)],
        )
        return try NativeProfile.applying(meta, to: base)
    }

    static func renderSampleImage(for spec: VowkeySampleScenario) -> UIImage {
        let size = CGSize(width: cardWidth, height: cardHeight)
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { ctx in
            let cg = ctx.cgContext

            UIColor(red: 0.97, green: 0.97, blue: 0.95, alpha: 1).setFill()
            cg.fill(CGRect(origin: .zero, size: size))

            let bandColor = UIColor(
                red: CGFloat((spec.headerHex >> 16) & 0xFF) / 255.0,
                green: CGFloat((spec.headerHex >> 8) & 0xFF) / 255.0,
                blue: CGFloat(spec.headerHex & 0xFF) / 255.0,
                alpha: 1,
            )
            bandColor.setFill()
            cg.fill(CGRect(x: 0, y: 0, width: cardWidth, height: 108))

            let titleAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 22),
                .foregroundColor: UIColor.white,
            ]
            let subAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 15, weight: .medium),
                .foregroundColor: UIColor(white: 1, alpha: 0.85),
            ]
            (spec.headerAuthority as NSString).draw(at: CGPoint(x: 36, y: 28), withAttributes: titleAttrs)
            (spec.headerSubtitle as NSString).draw(at: CGPoint(x: 36, y: 62), withAttributes: subAttrs)

            let portraitRect = CGRect(x: 36, y: 148, width: 204, height: 280)
            let portraitPath = UIBezierPath(roundedRect: portraitRect, cornerRadius: 16)
            UIColor(red: 0.91, green: 0.92, blue: 0.95, alpha: 1).setFill()
            portraitPath.fill()
            UIColor(red: 0.78, green: 0.80, blue: 0.85, alpha: 1).setStroke()
            portraitPath.lineWidth = 2
            portraitPath.stroke()

            let initialsAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.boldSystemFont(ofSize: 52),
                .foregroundColor: bandColor.withAlphaComponent(0.65),
            ]
            let initials = VowkeyMobileTheme.initials(for: spec.profileName) as NSString
            let initialsSize = initials.size(withAttributes: initialsAttrs)
            initials.draw(
                at: CGPoint(
                    x: portraitRect.midX - initialsSize.width / 2,
                    y: portraitRect.midY - initialsSize.height / 2,
                ),
                withAttributes: initialsAttrs,
            )

            let labelAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 13, weight: .semibold),
                .foregroundColor: UIColor(white: 0.38, alpha: 1),
            ]
            let valAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.systemFont(ofSize: 21, weight: .bold),
                .foregroundColor: UIColor(red: 0.08, green: 0.09, blue: 0.12, alpha: 1),
            ]

            for (index, field) in spec.fields.enumerated() {
                let rect = fieldBox(index: index).rect
                let boxPath = UIBezierPath(roundedRect: rect, cornerRadius: 10)
                UIColor.white.setFill()
                boxPath.fill()
                UIColor(white: 0.86, alpha: 1).setStroke()
                boxPath.lineWidth = 1.5
                boxPath.stroke()

                (field.printedLabel as NSString).draw(
                    in: CGRect(x: rect.minX + 12, y: rect.minY + 10, width: rect.width - 24, height: 20),
                    withAttributes: labelAttrs,
                )
                (field.value as NSString).draw(
                    in: CGRect(x: rect.minX + 12, y: rect.minY + 32, width: rect.width - 24, height: 32),
                    withAttributes: valAttrs,
                )
            }

            let mrzRect = CGRect(x: 0, y: 504, width: cardWidth, height: 136)
            UIColor(red: 0.93, green: 0.93, blue: 0.91, alpha: 1).setFill()
            cg.fill(mrzRect)
            let mrzAttrs: [NSAttributedString.Key: Any] = [
                .font: UIFont.monospacedSystemFont(ofSize: 20, weight: .medium),
                .foregroundColor: UIColor(white: 0.18, alpha: 1),
            ]
            (spec.footerLine1 as NSString).draw(at: CGPoint(x: 36, y: 534), withAttributes: mrzAttrs)
            (spec.footerLine2 as NSString).draw(at: CGPoint(x: 36, y: 574), withAttributes: mrzAttrs)
        }
    }
}
