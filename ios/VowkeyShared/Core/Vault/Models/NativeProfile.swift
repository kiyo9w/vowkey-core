import Foundation
import VowkeyResources
import VowkeySdk

enum NativeProfile {
    static func metadata(_ view: CipherView) throws -> [String: Any] {
        guard view.type == .identity, let id = view.id, view.deletedDate == nil,
              let fields = view.fields, fields.filter({ $0.name == "vk.meta" }).count == 1,
              let field = fields.first(where: { $0.name == "vk.meta" }), field.type == .hidden,
              let value = field.value,
              let object = try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any],
              object["v"] as? Int == 1, object["profileId"] as? String == id,
              object["details"] is [[String: Any]], object["sources"] is [[String: Any]] else { throw NativeVaultError.invalidInput }
        return object
    }
    static func confirmed(_ view: CipherView) -> Bool { (try? metadata(view)["status"] as? String) == "confirmed" }
    static func details(_ view: CipherView) -> [[String: Any]] { (try? metadata(view)["details"] as? [[String: Any]]) ?? [] }

    static func value(_ detail: [String: Any], variantId: String? = nil) -> String? {
        guard let variants = detail["variants"] as? [[String: Any]],
              let chosen = variantId ?? detail["chosenVariantId"] as? String,
              let variant = variants.first(where: { $0["id"] as? String == chosen && $0["current"] as? Bool != false }) else { return nil }
        return variant["value"] as? String
    }

    static func applying(_ meta: [String: Any], to view: CipherView) throws -> CipherView {
        guard meta["v"] as? Int == 1, meta["profileId"] as? String == view.id,
              let details = meta["details"] as? [[String: Any]] else { throw NativeVaultError.invalidInput }
        let data = try JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys, .withoutEscapingSlashes])
        let field = FieldView(name: "vk.meta", value: String(decoding: data, as: UTF8.self), type: .hidden, linkedId: nil)
        let fields = (view.fields ?? []).filter { $0.name != "vk.meta" } + [field]
        func projected(_ attribute: String, latin: Bool = false) -> String? {
            guard let detail = details.first(where: { $0["attribute"] as? String == attribute }) else { return nil }
            if latin, let variants = detail["variants"] as? [[String: Any]],
               let variant = variants.first(where: { $0["script"] as? String == "Latn" && $0["current"] as? Bool != false }) { return variant["value"] as? String }
            return value(detail)
        }
        let identity = IdentityView(title: projected("name.title"), firstName: projected("name.given", latin: true),
            middleName: projected("name.middle", latin: true), lastName: projected("name.family", latin: true),
            address1: projected("address.line1"), address2: projected("address.line2"), address3: projected("address.line3"),
            city: projected("address.city"), state: projected("address.state"), postalCode: projected("address.postal_code"),
            country: projected("address.country"), company: projected("work.employer"), email: projected("contact.email"),
            phone: projected("contact.phone"), ssn: projected("id.ssn"), username: projected("username"),
            passportNumber: projected("id.passport.number"), licenseNumber: projected("id.drivers_license.number"))
        return NativeCipher.replacing(view, identity: identity, fields: fields)
    }

    /// The printed name a new profile is called by, as the desktop app names it: the full name,
    /// Latin script first, else the given and family names.
    static func personName(_ values: [String: String]) -> String? {
        func named(_ attribute: String) -> String? {
            let matches = values.filter { split($0.key).0 == attribute }
                .sorted { (split($0.key).1 == nil ? 0 : 1, $0.key) < (split($1.key).1 == nil ? 0 : 1, $1.key) }
            return matches.first { $0.value.unicodeScalars.allSatisfy { $0.isASCII } }?.value ?? matches.first?.value
        }
        if let full = named("name.full"), !full.isEmpty { return full }
        let parts = [named("name.given"), named("name.family")].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: " ")
    }

    static func captured(_ document: [String: Any], fileName: String, mediaType: String, attachmentId: String,
                         into original: CipherView? = nil) throws -> CipherView {
        guard let values = document["details"] as? [String: String], !values.isEmpty else { throw NativeVaultError.unreadable }
        let id = original?.id ?? UUID().uuidString.lowercased()
        let view = original ?? NativeCipher.make(type: .identity, name: personName(values) ?? fileName, id: id)
        var meta = try original.map(metadata) ?? ["v": 1, "profileId": id, "kind": "person", "relationship": NSNull(),
            "status": "confirmed", "details": [], "sources": []]
        let sourceId = UUID().uuidString.lowercased()
        let origins = document["sources"] as? [String: [String: Any]] ?? [:]
        var details = meta["details"] as? [[String: Any]] ?? []
        for (rawAttribute, value) in values.sorted(by: { $0.key < $1.key }) {
            let (attribute, script, tag) = split(rawAttribute)
            let source = origins[rawAttribute] ?? [:]
            let variantId = UUID().uuidString.lowercased()
            var variant: [String: Any] = ["id": variantId, "script": script as Any? ?? NSNull(),
                "tag": tag as Any? ?? NSNull(), "value": value, "current": true, "sourceId": sourceId,
                "verified": source["verified"] as? Bool == true,
                "origin": origin(source["kind"] as? String ?? "ocr"), "locator": source["locator"] ?? NSNull()]
            if variant["origin"] as? String == "derived" { variant["verified"] = false }
            if let index = details.firstIndex(where: { $0["attribute"] as? String == attribute }) {
                var detail = details[index]
                var variants = detail["variants"] as? [[String: Any]] ?? []
                variants.append(variant)
                detail["variants"] = variants
                if value == self.value(detail) { variant["current"] = true }
                else {
                    var conflicts = detail["conflicts"] as? [[String: Any]] ?? []
                    conflicts.append(["variantId": variantId, "reason": "new_source"])
                    detail["conflicts"] = conflicts
                }
                if detail["agentRule"] == nil { detail["agentRule"] = "ask" }
                details[index] = detail
            } else {
                details.append(["id": UUID().uuidString.lowercased(), "attribute": attribute,
                    "label": displayLabel(for: attribute), "valueType": valueType(attribute),
                    "chosenVariantId": variantId, "agentRule": "ask", "variants": [variant], "history": [], "conflicts": []])
            }
        }
        var sources = meta["sources"] as? [[String: Any]] ?? []
        sources.append(["id": sourceId, "attachmentId": attachmentId, "fileName": fileName, "mediaType": mediaType,
            "kind": "document", "documentDate": NSNull(), "effectiveOn": NSNull(),
            "capturedAt": AgentManagementDate.string(Date()), "expiresOn": NSNull(), "status": "current"])
        meta["details"] = details; meta["sources"] = sources
        return try applying(meta, to: view)
    }

    static func typed(name: String, rows: [(String, String)]) throws -> CipherView {
        let id = UUID().uuidString.lowercased()
        let details: [[String: Any]] = rows.filter { !$0.0.isEmpty && !$0.1.isEmpty }.map { label, value in
            let variantId = UUID().uuidString.lowercased()
            return ["id": UUID().uuidString.lowercased(), "attribute": NSNull(), "label": label, "valueType": "text",
                "agentRule": "ask", "chosenVariantId": variantId, "history": [], "conflicts": [],
                "variants": [["id": variantId, "script": NSNull(), "tag": NSNull(), "value": value, "current": true,
                    "sourceId": NSNull(), "locator": NSNull(), "verified": false, "origin": "typed"]]]
        }
        guard !name.isEmpty, !details.isEmpty else { throw NativeVaultError.invalidInput }
        return try applying(["v": 1, "profileId": id, "kind": "person", "relationship": NSNull(),
            "status": "confirmed", "details": details, "sources": []], to: NativeCipher.make(type: .identity, name: name, id: id))
    }

    static func corrected(_ view: CipherView, detailId: String, value: String, rule: String) throws -> CipherView {
        var meta = try metadata(view)
        guard ["ask", "fill", "never"].contains(rule), var details = meta["details"] as? [[String: Any]],
              let index = details.firstIndex(where: { $0["id"] as? String == detailId }) else { throw NativeVaultError.invalidInput }
        var detail = details[index]
        if self.value(detail) != value {
            let variantId = UUID().uuidString.lowercased()
            var variants = detail["variants"] as? [[String: Any]] ?? []
            var history = detail["history"] as? [[String: Any]] ?? []
            history.append(["at": AgentManagementDate.string(Date()), "chosenVariantId": detail["chosenVariantId"] ?? NSNull(), "action": "correction"])
            variants.append(["id": variantId, "value": value, "script": NSNull(), "tag": NSNull(), "current": true,
                "sourceId": NSNull(), "locator": NSNull(), "verified": false, "origin": "correction"])
            detail["variants"] = variants; detail["chosenVariantId"] = variantId; detail["history"] = history
        }
        detail["agentRule"] = rule; details[index] = detail; meta["details"] = details
        return try applying(meta, to: view)
    }
    private static func split(_ key: String) -> (String, String?, String?) {
        for (suffix, script, tag) in [(".latin", "Latn", ""), (".katakana", "Kana", ""), (".hiragana", "Hira", ""), (".halfwidth_kana", "Kana", "halfwidth")] {
            if key.hasSuffix(suffix) { return (String(key.dropLast(suffix.count)), script, tag.isEmpty ? nil : tag) }
        }
        return (key, nil, nil)
    }
    private static func valueType(_ key: String) -> String {
        if key.contains("email") { return "email" }
        if key.contains("phone") { return "phone" }
        if key.contains("date") || key.hasSuffix(".birth") || key.hasSuffix(".expiry") { return "date" }
        return "text"
    }
    private static func origin(_ kind: String) -> String {
        switch kind { case "aamva", "cccd": "barcode"; case "mrz", "chip", "text", "typed", "correction", "derived", "import": kind; default: "ocr" }
    }
    static func displayLabel(for attribute: String) -> String {
        switch attribute {
        case "name.full", "person.full_name": Localizations.vowkeyAttrFullName
        case "name.given", "person.given_name": Localizations.vowkeyAttrGivenName
        case "name.family", "person.family_name": Localizations.vowkeyAttrFamilyName
        case "birth.date", "person.birth_date": Localizations.vowkeyAttrBirthDate
        case "nationality", "person.nationality": Localizations.vowkeyAttrNationality
        case "id.passport.number", "passport.number": Localizations.vowkeyAttrPassportNumber
        case "id.national.number", "id.ssn": Localizations.vowkeyAttrNationalId
        case "id.residence_card.number": Localizations.vowkeyAttrResidenceCard
        case "id.tax.number", "tax.id": Localizations.vowkeyAttrTaxNumber
        case "id.expiry_date", "passport.expiry_date": Localizations.vowkeyAttrExpiryDate
        case "id.issue_date", "passport.issue_date": Localizations.vowkeyAttrIssueDate
        case "address.full", "address.line1": Localizations.vowkeyAttrAddress
        case "contact.email": Localizations.email
        case "contact.phone": Localizations.phone
        case "work.employer": Localizations.vowkeyAttrEmployer
        default:
            attribute
                .replacingOccurrences(of: ".", with: " ")
                .replacingOccurrences(of: "_", with: " ")
                .localizedCapitalized
        }
    }
}
