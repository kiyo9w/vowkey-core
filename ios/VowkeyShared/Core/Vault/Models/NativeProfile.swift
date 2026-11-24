import Foundation
import VowkeyResources
import VowkeySdk

enum NativeProfile {
    static func metadata(_ view: CipherView) throws -> [String: Any] {
        guard view.type == .identity else { throw NativeVaultError.invalidInput }
        if let field = view.fields?.last(where: { $0.name == "vk.meta" }),
           let value = field.value,
           var object = try? JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any],
           object["v"] as? Int == 1,
           object["details"] is [[String: Any]] {
            if (object["profileId"] as? String)?.isEmpty != false {
                object["profileId"] = view.id ?? UUID().uuidString.lowercased()
            }
            if object["sources"] == nil {
                object["sources"] = [[String: Any]]()
            }
            if object["status"] == nil {
                object["status"] = "confirmed"
            }
            return object
        }
        let fallbackDetails = synthesizedIdentityDetails(from: view)
        guard !fallbackDetails.isEmpty else { throw NativeVaultError.invalidInput }
        return [
            "v": 1,
            "profileId": view.id ?? UUID().uuidString.lowercased(),
            "kind": "person",
            "relationship": NSNull(),
            "status": "confirmed",
            "details": fallbackDetails,
            "sources": [[String: Any]](),
        ]
    }

    static func confirmed(_ view: CipherView) -> Bool {
        guard view.deletedDate == nil, view.type == .identity else { return false }
        if let status = (try? metadata(view))?["status"] as? String {
            return status == "confirmed"
        }
        return !synthesizedIdentityDetails(from: view).isEmpty
    }

    static func details(_ view: CipherView) -> [[String: Any]] {
        let parsed = (try? metadata(view)["details"] as? [[String: Any]]) ?? []
        return parsed.isEmpty ? synthesizedIdentityDetails(from: view) : parsed
    }

    static func sources(_ view: CipherView) -> [[String: Any]] { (try? metadata(view)["sources"] as? [[String: Any]]) ?? [] }

    static func resolvedAttachmentKey(for source: [String: Any], cipher: CipherView? = nil) -> String {
        if let aid = (source["attachmentId"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !aid.isEmpty {
            return aid
        }
        if let fileName = (source["fileName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
           !fileName.isEmpty,
           let matched = cipher?.attachments?.first(where: {
               $0.fileName == fileName || $0.fileName?.caseInsensitiveCompare(fileName) == .orderedSame
           }),
           let id = matched.id, !id.isEmpty {
            return id
        }
        return (source["id"] as? String) ?? ""
    }

    private static func synthesizedIdentityDetails(from view: CipherView) -> [[String: Any]] {
        guard view.type == .identity else { return [] }
        var pairs: [(attribute: String?, label: String, value: String)] = []
        if let id = view.identity {
            let full = [id.lastName, id.middleName, id.firstName]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
                .joined(separator: " ")
            if !full.isEmpty {
                pairs.append(("name.full", displayLabel(for: "name.full"), full))
            }
            let candidates: [(String, String?)] = [
                ("name.given", id.firstName),
                ("name.family", id.lastName),
                ("contact.email", id.email),
                ("contact.phone", id.phone),
                ("id.passport.number", id.passportNumber),
                ("id.drivers_license.number", id.licenseNumber),
                ("id.ssn", id.ssn),
                ("address.line1", id.address1),
                ("address.city", id.city),
                ("address.state", id.state),
                ("address.postal_code", id.postalCode),
                ("address.country", id.country),
                ("work.employer", id.company),
            ]
            for (attr, rawVal) in candidates {
                if let clean = rawVal?.trimmingCharacters(in: .whitespacesAndNewlines), !clean.isEmpty {
                    pairs.append((attr, displayLabel(for: attr), clean))
                }
            }
        }
        for field in view.fields ?? [] where field.name != "vk.meta" && field.name != "vk.agentRule" && field.type != .hidden {
            if let label = field.name?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty,
               let clean = field.value?.trimmingCharacters(in: .whitespacesAndNewlines), !clean.isEmpty,
               !pairs.contains(where: { $0.label.caseInsensitiveCompare(label) == .orderedSame && $0.value == clean }) {
                pairs.append((nil, label, clean))
            }
        }
        return pairs.enumerated().map { idx, item in
            let vid = "synth-v-\(idx)"
            return [
                "id": "synth-d-\(idx)",
                "attribute": item.attribute as Any? ?? NSNull(),
                "label": item.label,
                "valueType": item.attribute.map(valueType) ?? "text",
                "agentRule": "fill",
                "chosenVariantId": vid,
                "history": [[String: Any]](),
                "conflicts": [[String: Any]](),
                "variants": [[
                    "id": vid,
                    "script": NSNull(),
                    "tag": NSNull(),
                    "value": item.value,
                    "current": true,
                    "sourceId": NSNull(),
                    "locator": NSNull(),
                    "verified": false,
                    "origin": "typed",
                ]],
            ]
        }
    }

    static func variants(_ detail: [String: Any]) -> [[String: Any]] {
        let all = (detail["variants"] as? [[String: Any]]) ?? []
        return all.filter { ($0["current"] as? Bool) != false }
    }

    static func locator(for detail: [String: Any]) -> [String: Any]? {
        let currentVariants = variants(detail)
        if let chosen = detail["chosenVariantId"] as? String,
           let matched = currentVariants.first(where: { ($0["id"] as? String) == chosen }),
           let loc = matched["locator"] as? [String: Any] {
            return loc
        }
        if let variantLoc = currentVariants.compactMap({ $0["locator"] as? [String: Any] }).first {
            return variantLoc
        }
        return detail["locator"] as? [String: Any]
    }

    static func sourceId(for detail: [String: Any]) -> String? {
        let currentVariants = variants(detail)
        if let chosen = detail["chosenVariantId"] as? String,
           let matched = currentVariants.first(where: { ($0["id"] as? String) == chosen }),
           let sid = matched["sourceId"] as? String, !sid.isEmpty {
            return sid
        }
        if let variantSid = currentVariants.compactMap({ $0["sourceId"] as? String }).first(where: { !$0.isEmpty }) {
            return variantSid
        }
        return (detail["sourceId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
    }

    static func addingDetail(
        _ view: CipherView,
        label: String,
        value: String,
        attribute: String? = nil,
        agentRule: String = "ask",
    ) throws -> CipherView {
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedValue = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLabel.isEmpty, !trimmedValue.isEmpty else { throw NativeVaultError.invalidInput }
        var meta = try metadata(view)
        var details = meta["details"] as? [[String: Any]] ?? []
        let variantId = UUID().uuidString.lowercased()
        let attrValue: Any = attribute?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? attribute!.trimmingCharacters(in: .whitespacesAndNewlines)
            : NSNull()
        let detail: [String: Any] = [
            "id": UUID().uuidString.lowercased(),
            "attribute": attrValue,
            "label": trimmedLabel,
            "valueType": attribute.map(valueType) ?? "text",
            "agentRule": ["ask", "fill", "never"].contains(agentRule) ? agentRule : "ask",
            "chosenVariantId": variantId,
            "history": [],
            "conflicts": [],
            "variants": [[
                "id": variantId,
                "script": NSNull(),
                "tag": NSNull(),
                "value": trimmedValue,
                "current": true,
                "sourceId": NSNull(),
                "locator": NSNull(),
                "verified": false,
                "origin": "typed",
            ]],
        ]
        details.append(detail)
        meta["details"] = details
        return try applying(meta, to: view)
    }

    static func updatingDetail(
        _ view: CipherView,
        detailId: String,
        value: String,
        label: String,
        agentRule: String = "ask",
    ) throws -> CipherView {
        let updated = try corrected(view, detailId: detailId, value: value, rule: agentRule)
        let trimmedLabel = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedLabel.isEmpty else { return updated }
        var meta = try metadata(updated)
        guard var details = meta["details"] as? [[String: Any]],
              let idx = details.firstIndex(where: { ($0["id"] as? String) == detailId }) else {
            return updated
        }
        var row = details[idx]
        row["label"] = trimmedLabel
        details[idx] = row
        meta["details"] = details
        return try applying(meta, to: updated)
    }

    static func removingDetail(_ view: CipherView, detailId: String) throws -> CipherView {
        var meta = try metadata(view)
        guard let details = meta["details"] as? [[String: Any]] else { throw NativeVaultError.invalidInput }
        meta["details"] = details.filter { ($0["id"] as? String) != detailId }
        return try applying(meta, to: view)
    }

    static func choosingVariant(_ view: CipherView, detailId: String, variantId: String) throws -> CipherView {
        var meta = try metadata(view)
        guard var details = meta["details"] as? [[String: Any]],
              let idx = details.firstIndex(where: { ($0["id"] as? String) == detailId }) else {
            throw NativeVaultError.invalidInput
        }
        var detail = details[idx]
        detail["chosenVariantId"] = variantId
        details[idx] = detail
        meta["details"] = details
        return try applying(meta, to: view)
    }

    static func choosingVariant(_ view: CipherView, detailId: String, chosenValue: String) throws -> CipherView {
        var meta = try metadata(view)
        guard var details = meta["details"] as? [[String: Any]],
              let idx = details.firstIndex(where: { ($0["id"] as? String) == detailId }) else {
            throw NativeVaultError.invalidInput
        }
        var detail = details[idx]
        let list = (detail["variants"] as? [[String: Any]]) ?? []
        if let matched = list.first(where: { ($0["value"] as? String) == chosenValue }),
           let vid = matched["id"] as? String {
            detail["chosenVariantId"] = vid
            details[idx] = detail
            meta["details"] = details
            return try applying(meta, to: view)
        }
        throw NativeVaultError.invalidInput
    }

    static func renamed(_ view: CipherView, name: String) throws -> CipherView {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw NativeVaultError.invalidInput }
        let updated = NativeCipher.replacing(view, name: trimmed)
        let meta = try metadata(updated)
        return try applying(meta, to: updated)
    }

    static func value(_ detail: [String: Any], variantId: String? = nil) -> String? {
        let currentVariants = variants(detail)
        guard !currentVariants.isEmpty else { return nil }
        if let explicitId = variantId ?? (detail["chosenVariantId"] as? String),
           !explicitId.isEmpty,
           let matched = currentVariants.first(where: { ($0["id"] as? String) == explicitId }) {
            return matched["value"] as? String
        }
        let primary = currentVariants.first(where: { $0["tag"] == nil || $0["tag"] is NSNull })
            ?? currentVariants.first
        return primary?["value"] as? String
    }

    static func applying(_ meta: [String: Any], to view: CipherView) throws -> CipherView {
        guard meta["v"] as? Int == 1,
              let details = meta["details"] as? [[String: Any]] else { throw NativeVaultError.invalidInput }
        var normalizedMeta = meta
        if let existingPid = normalizedMeta["profileId"] as? String, !existingPid.isEmpty {
            // Preserve logical profileId across server UUID reassignments.
        } else {
            normalizedMeta["profileId"] = view.id ?? UUID().uuidString.lowercased()
        }
        let data = try JSONSerialization.data(withJSONObject: normalizedMeta, options: [.sortedKeys, .withoutEscapingSlashes])
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

    static func captured(_ document: [String: Any], fileName: String, mediaType: String, attachmentId: String,
                         into original: CipherView? = nil) throws -> CipherView {
        guard let values = document["details"] as? [String: String], !values.isEmpty else { throw NativeVaultError.unreadable }
        let id = original?.id ?? UUID().uuidString.lowercased()
        let inferredName = [values["name.full"], values["name.full.latin"],
                            [values["name.family"], values["name.given"]].compactMap(\.self).joined(separator: " ").trimmingCharacters(in: .whitespaces)]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty }) ?? fileName
        let view = original ?? NativeCipher.make(type: .identity, name: inferredName, id: id)
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
        let inferredKind = inferDocumentKind(from: values, fileName: fileName)
        let expiryValue: Any = [
            values["id.passport.expiry"],
            values["id.residence_card.expiry"],
            values["id.expiry_date"],
            values["passport.expiry_date"],
            values["visa.expiry"],
        ].compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty }) ?? NSNull()
        sources.append(["id": sourceId, "attachmentId": attachmentId, "fileName": fileName, "mediaType": mediaType,
                        "kind": inferredKind, "documentDate": NSNull(), "effectiveOn": NSNull(),
                        "capturedAt": AgentManagementDate.string(Date()), "expiresOn": expiryValue, "status": "current"])
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
        case "name.full", "person.full_name": return Localizations.vowkeyAttrFullName
        case "name.given", "person.given_name": return Localizations.vowkeyAttrGivenName
        case "name.family", "person.family_name": return Localizations.vowkeyAttrFamilyName
        case "birth.date", "person.birth_date": return Localizations.vowkeyAttrBirthDate
        case "birth.place", "person.place_of_birth": return "Place of birth"
        case "person.hometown", "address.origin": return "Hometown"
        case "person.sex", "person.gender", "sex": return "Sex"
        case "person.marital_status": return "Marital status"
        case "person.ethnicity", "person.ethnic_group": return "Ethnicity"
        case "person.religion": return "Religion"
        case "nationality", "person.nationality": return Localizations.vowkeyAttrNationality
        case "id.passport.number", "passport.number": return Localizations.vowkeyAttrPassportNumber
        case "id.national.number", "id.citizen.number", "id.ssn": return Localizations.vowkeyAttrNationalId
        case "id.residence_card.number": return Localizations.vowkeyAttrResidenceCard
        case "id.drivers_license.number", "id.driver_license.number": return "Driver's license number"
        case "id.tax.number", "tax.id": return Localizations.vowkeyAttrTaxNumber
        case "id.expiry_date", "passport.expiry_date", "id.passport.expiry", "id.card.expiry": return Localizations.vowkeyAttrExpiryDate
        case "id.issue_date", "passport.issue_date", "id.passport.issued", "id.card.issued": return Localizations.vowkeyAttrIssueDate
        case "id.issuing_authority": return "Issuing authority"
        case "address.full", "address.line1": return Localizations.vowkeyAttrAddress
        case "address.permanent": return "Permanent address"
        case "address.residence", "address.current": return "Current address"
        case "address.prefecture", "address.state": return Localizations.stateProvince
        case "address.postal": return "Postal code"
        case "contact.email": return Localizations.email
        case "contact.phone": return Localizations.phone
        case "work.employer", "work.employer.name": return Localizations.vowkeyAttrEmployer
        case "work.title": return "Job title"
        case "bank.name": return "Bank"
        case "bank.account.number": return "Account number"
        case "bank.iban": return "IBAN"
        case "family.father.name", "family.father_name": return "Father's name"
        case "family.mother.name", "family.mother_name": return "Mother's name"
        case "spouse.name", "family.spouse_name": return "Spouse"
        case "family.head_of_household": return "Head of household"
        case "family.relationship": return "Relationship"
        default:
            if let rustLabel = [captureDetailLabel(key: attribute)].first(where: { !$0.isEmpty && $0 != attribute }) {
                return rustLabel
            }
            let stripped = attribute.replacingOccurrences(
                of: #"^(person|name|id|contact|address|work|bank|income|family|custom)\."#,
                with: "",
                options: .regularExpression,
            )
            let plain = stripped
                .replacingOccurrences(of: ".", with: " ")
                .replacingOccurrences(of: "_", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let first = plain.first else { return attribute }
            return String(first).uppercased() + plain.dropFirst()
        }
    }

    static func inferDocumentKind(from details: [String: String], fileName: String) -> String {
        if details["id.passport.number"] != nil || details["passport.number"] != nil { return "Passport" }
        if details["id.residence_card.number"] != nil { return "Residence card" }
        if details["id.national.number"] != nil || details["id.ssn"] != nil { return "National ID" }
        if details["id.drivers_license.number"] != nil { return "Driver's license" }
        if details["visa.number"] != nil || details["visa.status"] != nil { return "Visa" }
        if details["income.monthly.gross"] != nil || details["income.monthly.net"] != nil { return "Payslip" }
        if details["bank.account.number"] != nil || details["bank.iban"] != nil { return "Bank passbook" }
        let lower = fileName.lowercased()
        if lower.contains("passport") { return "Passport" }
        if lower.contains("residence") || lower.contains("zairyu") { return "Residence card" }
        if lower.contains("cccd") || lower.contains("national") { return "National ID" }
        if lower.contains("juminhyo") { return "Certificate of residence" }
        if lower.contains("marriage") || lower.contains("konin") { return "Marriage certificate" }
        if lower.contains("birth") { return "Birth certificate" }
        if lower.contains("payslip") || lower.contains("salary") { return "Payslip" }
        if lower.contains("bank") { return "Bank passbook" }
        return "Document"
    }

    static func humanDocumentTitle(for source: [String: Any], fallbackName: String) -> String {
        let candidates = [
            source["documentKind"] as? String,
            source["title"] as? String,
            source["kind"] as? String,
        ]
        for raw in candidates {
            guard let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !trimmed.isEmpty,
                  trimmed.caseInsensitiveCompare("document") != .orderedSame else { continue }
            if let mapped = canonicalDocumentKindLabel(trimmed) {
                return mapped
            }
            if trimmed.contains("_") || trimmed.contains("-") {
                return polishDocumentFilename(trimmed)
            }
            return trimmed
        }
        let rawFallback = ((source["fileName"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines))
            .flatMap { $0.isEmpty ? nil : $0 } ?? fallbackName
        if rawFallback.caseInsensitiveCompare("document") == .orderedSame || rawFallback.isEmpty {
            return "Document"
        }
        let inferred = inferDocumentKind(from: [:], fileName: rawFallback)
        if inferred != "Document" {
            return inferred
        }
        return polishDocumentFilename(rawFallback)
    }

    private static func canonicalDocumentKindLabel(_ raw: String) -> String? {
        switch raw.lowercased() {
        case "passport": "Passport"
        case "residence_card", "residence-card": "Residence card"
        case "residence_card_back", "residence-card-back": "Residence card (back)"
        case "cccd", "national_id", "national-id": "National ID"
        case "my_number_card", "my-number-card": "My Number card"
        case "juminhyo": "Certificate of residence"
        case "payslip": "Payslip"
        case "bank_card", "bank-card": "Bank card"
        case "bank_passbook", "bank-passbook": "Bank passbook"
        case "birth_certificate", "birth-certificate": "Birth certificate"
        case "marriage_certificate", "marriage-certificate": "Marriage certificate"
        case "health_insurance", "health_insurance_certificate", "health-insurance": "Health insurance certificate"
        case "school_enrolment", "school_enrolment_certificate", "school-enrolment": "School enrolment certificate"
        case "visa": "Visa"
        default: nil
        }
    }

    private static func polishDocumentFilename(_ raw: String) -> String {
        let withoutExt = (raw as NSString).deletingPathExtension
        let stripped = withoutExt.replacingOccurrences(
            of: #"^(?:vk_doc_|vk_form_|photo-|scanned-|document-|\d+[-_\s]+)"#,
            with: "",
            options: .regularExpression,
        )
        let spaced = stripped
            .replacingOccurrences(of: "_", with: " ")
            .replacingOccurrences(of: "-", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !spaced.isEmpty else { return "Document" }
        let first = spaced.prefix(1).uppercased() + spaced.dropFirst()
        return first.replacingOccurrences(of: #"\bId\b"#, with: "ID", options: [.regularExpression, .caseInsensitive])
    }

    static func humanVariantBadge(script: String?, tag: String?) -> String? {
        let cleanTag = tag?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch cleanTag.lowercased() {
        case "wareki": return "Japanese era"
        case "zengin", "halfwidth": return "Bank kana"
        default: break
        }
        let cleanScript = script?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch cleanScript.lowercased() {
        case "latn", "latin": return "Latin"
        case "kana", "katakana": return "Kana"
        case "hira", "hiragana": return "Hiragana"
        case "hani", "jpan", "hans", "hant": return "Kanji"
        case "": return cleanTag.isEmpty ? nil : cleanTag
        default: return cleanScript
        }
    }

    static func humanAgentRuleLabel(_ rule: String) -> String {
        switch rule {
        case "fill": "Fill without asking"
        case "never": "Don't fill"
        default: "Ask first"
        }
    }

    /// Converts a raw field path like `person.fullName` or `id.citizen.number`
    /// to a human-readable label: "Full name", "Citizen number", etc.
    static func humanAttributeLabel(for fieldPath: String) -> String {
        let known: [String: String] = [
            "person.fullName": "Full name",
            "person.firstName": "First name",
            "person.middleName": "Middle name",
            "person.lastName": "Last name",
            "person.sex": "Sex",
            "person.dateOfBirth": "Date of birth",
            "person.placeOfBirth": "Place of birth",
            "person.ethnicity": "Ethnicity",
            "person.nationality": "Nationality",
            "person.religion": "Religion",
            "id.citizen.number": "Citizen ID number",
            "id.citizen.issueDate": "Citizen ID issue date",
            "id.citizen.expiryDate": "Citizen ID expiry date",
            "id.citizen.issuingAuthority": "Issuing authority",
            "id.passport.number": "Passport number",
            "id.passport.issueDate": "Passport issue date",
            "id.passport.expiryDate": "Passport expiry date",
            "id.taxNumber": "Tax ID",
            "id.socialInsurance": "Social insurance number",
            "contact.phone": "Phone",
            "contact.email": "Email",
            "address.permanent": "Permanent address",
            "address.residence": "Current residence",
            "work.employer": "Employer",
            "work.occupation": "Occupation",
            "work.position": "Position",
            "family.fatherName": "Father's name",
            "family.motherName": "Mother's name",
            "family.spouseName": "Spouse's name",
            "banking.accountNumber": "Bank account",
            "banking.bankName": "Bank name",
        ]
        if let label = known[fieldPath] { return label }
        // Fallback: take the last dotted component and title-case it
        let last = fieldPath.split(separator: ".").last.map(String.init) ?? fieldPath
        return last.prefix(1).uppercased() + last.dropFirst()
    }
}
