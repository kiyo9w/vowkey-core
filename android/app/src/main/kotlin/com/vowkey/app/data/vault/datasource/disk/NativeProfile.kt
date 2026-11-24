package com.vowkey.app.data.vault.datasource.disk

import com.vowkey.sdk.captureDetailLabel
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import com.vowkey.vault.FieldType
import com.vowkey.vault.FieldView
import com.vowkey.vault.IdentityView
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.*

/** The encrypted profile contract shared by the web, desktop and native clients. */
internal fun CipherView.profileEnvelope(): JsonObject? {
    if (type != CipherType.IDENTITY) return null
    val field = fields.orEmpty().lastOrNull { it.name == "vk.meta" } ?: return null
    val meta = Json.parseToJsonElement(field.value ?: return null).jsonObject
    check(meta["v"] == JsonPrimitive(1)) { "Update Vowkey to edit this profile." }
    check(meta["details"] is JsonArray) { "Couldn't read this profile's details." }
    val sourcesArray = (meta["sources"] as? JsonArray) ?: JsonArray(emptyList())
    // Legacy v1 metadata omitted defaults; its logical ids survive the upgrade.
    val details = meta.getValue("details").jsonArray.map { entry ->
        val detail = entry.jsonObject
        val variants = detail.getValue("variants").jsonArray.map { value ->
            val variant = value.jsonObject
            JsonObject(buildJsonObject {
                put("script", JsonNull); put("tag", JsonNull); put("current", true)
                put("sourceId", JsonNull); put("locator", JsonNull); put("verified", false); put("origin", "text")
            } + variant)
        }
        val attributeElement = detail["attribute"] ?: detail["key"] ?: JsonNull
        val attribute = attributeElement.jsonPrimitive.contentOrNull
        val rawLabel = detail["label"]?.jsonPrimitive?.contentOrNull
        val resolvedLabel = humanDetailLabel(attribute, rawLabel).ifBlank { "Detail" }
        JsonObject(buildJsonObject {
            put("attribute", attributeElement)
            put("label", resolvedLabel)
            put("valueType", "text"); put("chosenVariantId", variants.firstOrNull()?.get("id") ?: JsonNull)
            put("agentRule", "ask"); put("history", JsonArray(emptyList())); put("conflicts", JsonArray(emptyList()))
        } + detail + mapOf(
            "label" to JsonPrimitive(resolvedLabel),
            "variants" to JsonArray(variants),
        ))
    }
    return JsonObject(
        mapOf("relationship" to JsonNull, "sources" to sourcesArray) +
            meta +
            ("details" to JsonArray(details)) +
            ("sources" to sourcesArray),
    )
}

internal fun CipherView.isNativeProfileUsableForFill(): Boolean =
    type != CipherType.IDENTITY || fields.orEmpty().none { it.name == "vk.meta" } ||
        runCatching { profileEnvelope()?.get("status") == JsonPrimitive("confirmed") }.getOrDefault(false)

internal fun newNativeProfile(name: String, values: Map<String, String>, origin: String = "text"): CipherView {
    val id = UUID.randomUUID().toString()
    val meta = buildJsonObject {
        put("v", 1); put("profileId", id); put("kind", "person")
        put("relationship", JsonNull); put("status", "confirmed")
        put("details", JsonArray(values.entries.groupBy { splitAttribute(it.key).first }.map { (attribute, entries) ->
            val variants = entries.map { (key, value) ->
                val (_, script, tag) = splitAttribute(key)
                nativeVariant(value, if (tag == null) origin else "derived", script, tag)
            }
            buildJsonObject {
                put("id", UUID.randomUUID().toString()); put("attribute", attribute)
                put("label", humanDetailLabel(attribute)); put("valueType", valueType(attribute))
                put("chosenVariantId", variants.first().getValue("id")); put("agentRule", "ask")
                put("variants", JsonArray(variants))
                put("history", JsonArray(emptyList())); put("conflicts", JsonArray(emptyList()))
            }
        }))
        put("sources", JsonArray(emptyList()))
    }
    return newNativeCipher(CipherType.IDENTITY).copy(id = id, name = name).withProfileEnvelope(meta)
}

internal fun CipherView.addProfileDetail(label: String, value: String): CipherView {
    val meta = checkNotNull(profileEnvelope())
    val variant = nativeVariant(value, "typed")
    val detail = buildJsonObject {
        put("id", UUID.randomUUID().toString()); put("attribute", JsonNull); put("label", label)
        put("valueType", "text"); put("chosenVariantId", variant.getValue("id")); put("agentRule", "ask")
        put("variants", JsonArray(listOf(variant))); put("history", JsonArray(emptyList()))
        put("conflicts", JsonArray(emptyList()))
    }
    return withProfileEnvelope(JsonObject(meta + ("details" to JsonArray(meta.getValue("details").jsonArray + detail))))
}

internal fun CipherView.withProfileEnvelope(meta: JsonObject): CipherView {
    val field = FieldView("vk.meta", meta.toString(), FieldType.HIDDEN, null)
    return copy(fields = fields.orEmpty().filterNot { it.name == "vk.meta" } + field)
        .projectProfile(meta)
}

/** Physical cipher ids change at attachment; logical detail, variant and source ids do not. */
internal fun CipherView.withPhysicalProfileId(id: String): CipherView {
    if (type != CipherType.IDENTITY) return copy(id = id)
    val meta = profileEnvelope() ?: return copy(id = id)
    return copy(id = id).withProfileEnvelope(JsonObject(meta + ("profileId" to JsonPrimitive(id))))
}

internal fun JsonObject.detailValue(): String {
    val variants = getValue("variants").jsonArray.map { it.jsonObject }
    return (variants.firstOrNull { it["id"] == get("chosenVariantId") }
        ?: variants.firstOrNull {
            it["current"] == JsonPrimitive(true) && (it["tag"] == null || it["tag"] == JsonNull)
        }
        ?: variants.firstOrNull { it["current"] == JsonPrimitive(true) })
        ?.get("value")?.jsonPrimitive?.content.orEmpty()
}

/** Replaces only changed values, retaining the original variant and its source in history. */
internal fun CipherView.editProfile(name: String, values: Map<String, String>): CipherView {
    val meta = checkNotNull(profileEnvelope())
    val details = meta.getValue("details").jsonArray.map { entry ->
        val detail = entry.jsonObject
        val id = detail.getValue("id").jsonPrimitive.content
        val variants = detail.getValue("variants").jsonArray.map { it.jsonObject }
        val selectedId = (variants.firstOrNull { it["id"] == detail["chosenVariantId"] }
            ?: variants.firstOrNull { it["current"] == JsonPrimitive(true) })?.get("id")
        var chosen = detail["chosenVariantId"] ?: JsonNull
        val history = detail["history"]?.jsonArray.orEmpty().toMutableList()
        val updated = variants.map variant@{ variant ->
            val variantId = variant.getValue("id").jsonPrimitive.content
            val value = values["$id/$variantId"] ?: values[id].takeIf { variant["id"] == selectedId }
            if (value == null || variant["value"] == JsonPrimitive(value)) return@variant variant
            val replacement = nativeVariant(value, "correction", variant["script"]?.jsonPrimitive?.contentOrNull,
                variant["tag"]?.jsonPrimitive?.contentOrNull)
            if (variant["id"] == selectedId) chosen = replacement.getValue("id")
            history += buildJsonObject {
                put("variant", JsonObject(variant + ("current" to JsonPrimitive(false))))
                put("retiredAt", Instant.now().toString()); put("reason", "correction")
            }
            replacement
        }
        JsonObject(detail + mapOf(
            "chosenVariantId" to chosen,
            "agentRule" to (detail["agentRule"] ?: JsonPrimitive("ask")),
            "variants" to JsonArray(updated),
            "history" to JsonArray(history),
        ))
    }
    return copy(name = name).withProfileEnvelope(JsonObject(meta + ("details" to JsonArray(details))))
}

private fun nativeVariant(value: String, origin: String, script: String? = null, tag: String? = null) = buildJsonObject {
    put("id", UUID.randomUUID().toString()); put("script", script?.let(::JsonPrimitive) ?: JsonNull); put("tag", tag?.let(::JsonPrimitive) ?: JsonNull)
    put("value", value); put("current", true); put("sourceId", JsonNull)
    put("locator", JsonNull); put("verified", false); put("origin", origin)
}

private fun valueType(attribute: String): String = when {
    Regex("(^|\\.)(date|expiry|issued|birth)(\\.|$)|_date$").containsMatchIn(attribute) -> "date"
    attribute == "contact.email" -> "email"
    attribute == "contact.phone" -> "phone"
    attribute.startsWith("address.") -> "address"
    else -> "text"
}

private fun CipherView.projectProfile(meta: JsonObject): CipherView {
    val values = meta.getValue("details").jsonArray.map { it.jsonObject }.associate {
        val attribute = it["attribute"]?.jsonPrimitive?.contentOrNull ?: it["key"]?.jsonPrimitive?.content.orEmpty()
        val latin = if (attribute.startsWith("name.")) it.getValue("variants").jsonArray.map { variant -> variant.jsonObject }
            .firstOrNull { variant -> variant["script"] == JsonPrimitive("Latn") && variant["current"] == JsonPrimitive(true) }
            ?.get("value")?.jsonPrimitive?.content else null
        attribute to (latin ?: it.detailValue())
    }
    return copy(identity = IdentityView(
        title = values["name.prefix"], firstName = values["name.given.latin"] ?: values["name.given"], middleName = values["name.middle"],
        lastName = values["name.family.latin"] ?: values["name.family"], address1 = values["address.street"], address2 = values["address.building"],
        address3 = values["address.line3"], city = values["address.city"], state = values["address.prefecture"],
        postalCode = values["address.postal"], country = values["address.country"], company = values["work.employer.name"],
        email = values["contact.email"], phone = values["contact.phone.mobile"] ?: values["contact.phone"], ssn = values["id.ssn"], username = null,
        passportNumber = values["id.passport.number"], licenseNumber = values["id.driver_license.number"],
    ))
}

private fun splitAttribute(key: String): Triple<String, String?, String?> {
    val suffixes = mapOf("latin" to "Latn", "kana" to "Kana", "hiragana" to "Hira", "kanji" to "Hani", "hangul" to "Hang")
    val suffix = key.substringAfterLast('.')
    return when {
        suffix in suffixes -> Triple(key.substringBeforeLast('.'), suffixes[suffix], null)
        suffix == "wareki" || suffix == "zengin" -> Triple(key.substringBeforeLast('.'), null, suffix)
        else -> Triple(key, null, null)
    }
}

private val CANONICAL_DETAIL_LABELS: Map<String, String> = mapOf(
    "name.full" to "Full name",
    "name.full.latin" to "Full name (Latin letters)",
    "name.full.kana" to "Full name (kana)",
    "name.full.hiragana" to "Full name (hiragana)",
    "name.full.zengin" to "Full name (bank format)",
    "name.given" to "Given name",
    "name.given.latin" to "Given name (Latin letters)",
    "name.given.kana" to "Given name (kana)",
    "name.given.hiragana" to "Given name (hiragana)",
    "name.family" to "Family name",
    "name.family.latin" to "Family name (Latin letters)",
    "name.family.kana" to "Family name (kana)",
    "name.family.hiragana" to "Family name (hiragana)",
    "name.middle" to "Middle name",
    "name.birth" to "Birth name",
    "name.prefix" to "Title",
    "birth.date" to "Date of birth",
    "birth.date.wareki" to "Date of birth (Japanese era)",
    "birth.year" to "Birth year",
    "birth.month" to "Birth month",
    "birth.day" to "Birth day",
    "birth.era" to "Birth era",
    "birth.era_year" to "Birth era year",
    "birth.age" to "Age",
    "birth.place" to "Place of birth",
    "birth.country" to "Country of birth",
    "person.sex" to "Sex",
    "person.sex.code" to "Sex (code)",
    "person.nationality" to "Nationality",
    "person.nationality.code" to "Nationality (code)",
    "person.marital_status" to "Marital status",
    "person.profession" to "Occupation",
    "person.religion" to "Religion",
    "person.ethnicity" to "Ethnicity",
    "person.blood_type" to "Blood type",
    "contact.email" to "Email",
    "contact.phone" to "Phone",
    "contact.phone.mobile" to "Mobile phone",
    "contact.phone.home" to "Home phone",
    "address.full" to "Address",
    "address.postal" to "Postal code",
    "address.prefecture" to "State / Province / Prefecture",
    "address.city" to "City",
    "address.street" to "Street",
    "address.building" to "Building",
    "address.country" to "Country",
    "id.passport.number" to "Passport number",
    "id.passport.issued" to "Passport issued",
    "id.passport.country" to "Passport issuing country",
    "id.passport.expiry" to "Passport expiry",
    "id.national.number" to "National ID number",
    "id.card.number" to "Document number",
    "id.card.issued" to "Document issued",
    "id.card.expiry" to "Document expiry",
    "id.card.extra_number" to "Card access number",
    "id.issuing_authority" to "Issuing authority",
    "id.driver_license.number" to "Driver's licence number",
    "id.driver_license.class" to "Licence class",
    "id.driver_license.restrictions" to "Licence restrictions",
    "id.residence_card.number" to "Residence card number",
    "id.residence_card.issued" to "Residence card issued",
    "id.ssn" to "Social security number",
    "id.ssn.last4" to "Social security number (last 4)",
    "id.mynumber" to "My Number",
    "id.pension.number" to "Pension number",
    "id.employment_insurance.number" to "Employment insurance number",
    "id.health_insurance.number" to "Health insurance number",
    "id.tax.de_steuer_id" to "Tax ID (Steuer-ID)",
    "id.tax.number" to "Tax number",
    "id.employer.ein" to "Employer tax number",
    "visa.status" to "Status of residence",
    "visa.period" to "Period of stay",
    "visa.expiry" to "Stay expires",
    "bank.name" to "Bank",
    "bank.code" to "Bank code",
    "bank.branch.name" to "Branch",
    "bank.branch.name.kana" to "Branch (kana)",
    "bank.branch.code" to "Branch code",
    "bank.account.type" to "Account type",
    "bank.account.number" to "Account number",
    "bank.account.holder.kanji" to "Account holder",
    "bank.account.holder.kana" to "Account holder (kana)",
    "bank.account.holder.zengin" to "Account holder (bank format)",
    "bank.iban" to "IBAN",
    "bank.bic" to "BIC / SWIFT",
    "bank.jp_post.symbol" to "Japan Post symbol",
    "bank.jp_post.number" to "Japan Post account number",
    "work.employer.name" to "Employer",
    "work.employer.name.kana" to "Employer (kana)",
    "work.employer.address" to "Employer address",
    "work.employer.postal" to "Employer postal code",
    "work.employer.phone" to "Employer phone",
    "work.employer.representative" to "Employer representative",
    "work.title" to "Job title",
    "work.department" to "Department",
    "work.employee_id" to "Employee number",
    "work.employment_type" to "Employment type",
    "work.start.date" to "Start date",
    "work.hours" to "Working hours",
    "work.job_description" to "Job duties",
    "income.annual" to "Annual income",
    "income.bonus" to "Bonus",
    "income.monthly.base" to "Monthly base pay",
    "income.monthly.overtime" to "Overtime pay",
    "income.monthly.commute" to "Commuting allowance",
    "income.monthly.housing" to "Housing allowance",
    "income.monthly.gross" to "Monthly pay before deductions",
    "income.monthly.net" to "Monthly pay after deductions",
    "income.insurance.health" to "Health insurance contribution",
    "income.insurance.pension" to "Pension contribution",
    "income.insurance.employment" to "Employment insurance contribution",
    "income.insurance.total" to "Total insurance deductions",
    "income.tax.income" to "Income tax withheld",
    "income.tax.resident" to "Resident tax",
    "income.pay_date" to "Pay date",
    "income.pay_period" to "Pay period",
    "emergency.name" to "Emergency contact",
    "emergency.name.kana" to "Emergency contact (kana)",
    "emergency.relation" to "Emergency contact relationship",
    "emergency.phone" to "Emergency contact phone",
    "emergency.address" to "Emergency contact address",
    "spouse.name" to "Spouse",
    "family.father.name" to "Father's name",
    "family.mother.name" to "Mother's name",
    "education.school.name" to "School",
    "education.degree" to "Degree",
    "education.graduation.date" to "Graduation",
)

private fun mechanicalAttributeLabel(attribute: String): String {
    val stripped = attribute.replace(
        Regex("^(person|name|id|contact|address|work|bank|income|family|custom)\\."),
        "",
    )
    val words = stripped.replace(Regex("[._]"), " ").trim()
    return if (words.isEmpty()) attribute else words[0].uppercaseChar() + words.substring(1)
}

internal fun humanDetailLabel(attribute: String?, label: String? = null): String {
    if (attribute != null && attribute in CANONICAL_DETAIL_LABELS) {
        if (label.isNullOrBlank() || label == attribute || label == mechanicalAttributeLabel(attribute)) {
            return CANONICAL_DETAIL_LABELS.getValue(attribute)
        }
    }
    if (!label.isNullOrBlank()) {
        return if (attribute != null && label == attribute) {
            runCatching { captureDetailLabel(attribute) }.getOrDefault(mechanicalAttributeLabel(attribute))
        } else {
            label
        }
    }
    if (attribute != null) {
        return CANONICAL_DETAIL_LABELS[attribute]
            ?: runCatching { captureDetailLabel(attribute) }.getOrDefault(mechanicalAttributeLabel(attribute))
    }
    return ""
}

internal fun CipherView.profileFlatDetails(): Map<String, String> {
    val meta = runCatching { profileEnvelope() }.getOrNull()
    val out = linkedMapOf<String, String>()
    if (meta != null) {
        for (entry in meta["details"]?.jsonArray.orEmpty()) {
            val detail = entry.jsonObject
            if (detail["agentRule"]?.jsonPrimitive?.contentOrNull == "never") continue
            val baseAttr = detail["attribute"]?.jsonPrimitive?.contentOrNull
                ?: detail["key"]?.jsonPrimitive?.contentOrNull
                ?: continue
            if (baseAttr.isBlank()) continue
            val primaryVal = detail.detailValue()
            if (primaryVal.isNotBlank()) out[baseAttr] = primaryVal
            for (vEntry in detail["variants"]?.jsonArray.orEmpty()) {
                val v = vEntry.jsonObject
                if (v["current"] != JsonPrimitive(true)) continue
                val valStr = v["value"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (valStr.isEmpty()) continue
                val script = v["script"]?.jsonPrimitive?.contentOrNull
                val tag = v["tag"]?.jsonPrimitive?.contentOrNull
                val suffix = when (script) {
                    "Latn" -> "latin"
                    "Kana" -> "kana"
                    "Hira" -> "hiragana"
                    "Hani" -> "kanji"
                    "Hang" -> "hangul"
                    else -> tag
                }
                if (!suffix.isNullOrBlank()) {
                    out.putIfAbsent("$baseAttr.$suffix", valStr)
                }
            }
        }
    }
    if (out.isEmpty() && type == CipherType.IDENTITY) {
        identity?.let { id ->
            val full = listOfNotNull(id.lastName, id.middleName, id.firstName)
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .joinToString(" ")
            if (full.isNotEmpty()) out["name.full"] = full
            id.firstName?.trim()?.takeIf { it.isNotEmpty() }?.let { out["name.given"] = it }
            id.lastName?.trim()?.takeIf { it.isNotEmpty() }?.let { out["name.family"] = it }
            id.email?.trim()?.takeIf { it.isNotEmpty() }?.let { out["contact.email"] = it }
            id.phone?.trim()?.takeIf { it.isNotEmpty() }?.let { out["contact.phone"] = it }
            id.passportNumber?.trim()?.takeIf { it.isNotEmpty() }?.let { out["id.passport.number"] = it }
            id.licenseNumber?.trim()?.takeIf { it.isNotEmpty() }?.let { out["id.driver_license.number"] = it }
            id.ssn?.trim()?.takeIf { it.isNotEmpty() }?.let { out["id.ssn"] = it }
            id.address1?.trim()?.takeIf { it.isNotEmpty() }?.let { out["address.street"] = it }
            id.city?.trim()?.takeIf { it.isNotEmpty() }?.let { out["address.city"] = it }
            id.state?.trim()?.takeIf { it.isNotEmpty() }?.let { out["address.prefecture"] = it }
            id.postalCode?.trim()?.takeIf { it.isNotEmpty() }?.let { out["address.postal"] = it }
            id.country?.trim()?.takeIf { it.isNotEmpty() }?.let { out["address.country"] = it }
            id.company?.trim()?.takeIf { it.isNotEmpty() }?.let { out["work.employer.name"] = it }
        }
    }
    return out
}

internal fun newCapturedNativeProfile(
    name: String,
    values: Map<String, String>,
    locators: Map<String, JsonElement> = emptyMap(),
    sourceRecord: JsonObject? = null,
    origin: String = "ocr",
): CipherView {
    val id = UUID.randomUUID().toString()
    val sourceId = sourceRecord?.get("id")?.jsonPrimitive?.contentOrNull
    val meta = buildJsonObject {
        put("v", 1)
        put("profileId", id)
        put("kind", "person")
        put("relationship", JsonNull)
        put("status", "confirmed")
        put("details", buildCapturedDetailsArray(values, locators, sourceId, origin))
        put("sources", JsonArray(listOfNotNull(sourceRecord)))
    }
    return newNativeCipher(CipherType.IDENTITY).copy(id = id, name = name).withProfileEnvelope(meta)
}

internal fun CipherView.mergeCapturedDetails(
    values: Map<String, String>,
    locators: Map<String, JsonElement> = emptyMap(),
    sourceRecord: JsonObject? = null,
    origin: String = "ocr",
): CipherView {
    val meta = profileEnvelope() ?: return newCapturedNativeProfile(name, values, locators, sourceRecord, origin)
    val sourceId = sourceRecord?.get("id")?.jsonPrimitive?.contentOrNull
    val existingDetails = meta["details"]?.jsonArray.orEmpty().map { it.jsonObject }.toMutableList()
    val incoming = buildCapturedDetailsArray(values, locators, sourceId, origin).map { it.jsonObject }
    for (inc in incoming) {
        val incAttr = inc["attribute"]?.jsonPrimitive?.contentOrNull
        val idx = existingDetails.indexOfFirst {
            incAttr != null && it["attribute"]?.jsonPrimitive?.contentOrNull == incAttr
        }
        if (idx < 0) {
            existingDetails += inc
        } else {
            val prev = existingDetails[idx]
            val prevVariants = prev["variants"]?.jsonArray.orEmpty().map { it.jsonObject }.toMutableList()
            for (vEl in inc["variants"]?.jsonArray.orEmpty()) {
                val vObj = vEl.jsonObject
                val vVal = vObj["value"]?.jsonPrimitive?.contentOrNull
                val vScript = vObj["script"]
                val vTag = vObj["tag"]
                val alreadyHas = prevVariants.any {
                    it["value"]?.jsonPrimitive?.contentOrNull == vVal &&
                        it["script"] == vScript &&
                        it["tag"] == vTag
                }
                if (!alreadyHas) prevVariants += vObj
            }
            existingDetails[idx] = JsonObject(prev + ("variants" to JsonArray(prevVariants)))
        }
    }
    val existingSources = meta["sources"]?.jsonArray.orEmpty().toMutableList()
    if (sourceRecord != null) existingSources += sourceRecord
    val updatedMeta = JsonObject(
        meta + mapOf(
            "details" to JsonArray(existingDetails),
            "sources" to JsonArray(existingSources),
        ),
    )
    return withProfileEnvelope(updatedMeta)
}

private fun buildCapturedDetailsArray(
    values: Map<String, String>,
    locators: Map<String, JsonElement>,
    sourceId: String?,
    origin: String,
): JsonArray = JsonArray(
    values.entries
        .filter { it.value.isNotBlank() }
        .groupBy { splitAttribute(it.key).first }
        .map { (attribute, entries) ->
            val variants = entries.map { (rawKey, value) ->
                val (_, script, tag) = splitAttribute(rawKey)
                val loc = locators[rawKey] ?: locators[attribute]
                buildJsonObject {
                    put("id", UUID.randomUUID().toString())
                    put("script", script?.let(::JsonPrimitive) ?: JsonNull)
                    put("tag", tag?.let(::JsonPrimitive) ?: JsonNull)
                    put("value", value)
                    put("current", true)
                    put("sourceId", sourceId?.let(::JsonPrimitive) ?: JsonNull)
                    put("locator", loc ?: JsonNull)
                    put("verified", false)
                    put("origin", if (tag == null) origin else "derived")
                }
            }
            buildJsonObject {
                put("id", UUID.randomUUID().toString())
                put("attribute", attribute)
                put("label", humanDetailLabel(attribute))
                put("valueType", valueType(attribute))
                put("chosenVariantId", variants.first().getValue("id"))
                put("agentRule", "ask")
                put("variants", JsonArray(variants))
                put("history", JsonArray(emptyList()))
                put("conflicts", JsonArray(emptyList()))
            }
        },
)

internal fun CipherView.profileDetails(): List<JsonObject> =
    runCatching { profileEnvelope()?.get("details")?.jsonArray?.map { it.jsonObject }.orEmpty() }
        .getOrDefault(emptyList())

internal fun CipherView.profileSources(): List<JsonObject> =
    runCatching { profileEnvelope()?.get("sources")?.jsonArray?.map { it.jsonObject }.orEmpty() }
        .getOrDefault(emptyList())

internal fun JsonObject.detailVariants(): List<JsonObject> =
    this["variants"]?.jsonArray.orEmpty()
        .map { it.jsonObject }
        .filter { it["current"] != JsonPrimitive(false) }

internal fun JsonObject.detailLocator(): JsonObject? {
    val current = detailVariants()
    val chosenId = this["chosenVariantId"]?.jsonPrimitive?.contentOrNull
    val chosenLoc = chosenId?.let { cid ->
        current.firstOrNull { it["id"]?.jsonPrimitive?.contentOrNull == cid }?.get("locator")
    }
    if (chosenLoc is JsonObject) return chosenLoc
    val anyLoc = current.firstNotNullOfOrNull { (it["locator"] as? JsonObject) }
    if (anyLoc != null) return anyLoc
    return this["locator"] as? JsonObject
}

internal fun JsonObject.detailSourceId(): String? {
    val current = detailVariants()
    val chosenId = this["chosenVariantId"]?.jsonPrimitive?.contentOrNull
    val chosenSid = chosenId?.let { cid ->
        current.firstOrNull { it["id"]?.jsonPrimitive?.contentOrNull == cid }
            ?.get("sourceId")?.jsonPrimitive?.contentOrNull
    }
    if (!chosenSid.isNullOrBlank()) return chosenSid
    val anySid = current.firstNotNullOfOrNull { it["sourceId"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank) }
    if (anySid != null) return anySid
    return this["sourceId"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank)
}

internal fun CipherView.chooseProfileVariant(detailId: String, variantIdOrValue: String): CipherView {
    val meta = profileEnvelope() ?: return this
    val updatedDetails = meta.getValue("details").jsonArray.map { el ->
        val row = el.jsonObject
        if (row["id"]?.jsonPrimitive?.contentOrNull != detailId) return@map row
        val variants = row["variants"]?.jsonArray.orEmpty().map { it.jsonObject }
        val matched = variants.firstOrNull {
            it["id"]?.jsonPrimitive?.contentOrNull == variantIdOrValue ||
                it["value"]?.jsonPrimitive?.contentOrNull == variantIdOrValue
        } ?: return@map row
        JsonObject(row + ("chosenVariantId" to (matched["id"] ?: JsonNull)))
    }
    return withProfileEnvelope(JsonObject(meta + ("details" to JsonArray(updatedDetails))))
}

internal fun CipherView.upsertProfileDetail(
    detailId: String?,
    label: String,
    value: String,
    attribute: String?,
    agentRule: String,
): CipherView {
    val trimmedLabel = label.trim()
    val trimmedValue = value.trim()
    if (trimmedLabel.isEmpty() || trimmedValue.isEmpty()) return this
    val safeRule = if (agentRule in setOf("fill", "ask", "never")) agentRule else "ask"
    val meta = profileEnvelope() ?: return this
    val existing = meta.getValue("details").jsonArray.map { it.jsonObject }.toMutableList()
    if (detailId == null) {
        val variant = nativeVariant(trimmedValue, "typed")
        existing += buildJsonObject {
            put("id", UUID.randomUUID().toString())
            put("attribute", attribute?.trim()?.takeIf { it.isNotEmpty() }?.let(::JsonPrimitive) ?: JsonNull)
            put("label", trimmedLabel)
            put("valueType", attribute?.let(::valueType) ?: "text")
            put("chosenVariantId", variant.getValue("id"))
            put("agentRule", safeRule)
            put("variants", JsonArray(listOf(variant)))
            put("history", JsonArray(emptyList()))
            put("conflicts", JsonArray(emptyList()))
        }
    } else {
        val index = existing.indexOfFirst { it["id"]?.jsonPrimitive?.contentOrNull == detailId }
        if (index >= 0) {
            val prev = existing[index]
            val prevVal = prev.detailValue()
            var chosenId = prev["chosenVariantId"] ?: JsonNull
            val variants = prev["variants"]?.jsonArray.orEmpty().map { it.jsonObject }.toMutableList()
            val history = prev["history"]?.jsonArray.orEmpty().toMutableList()
            if (prevVal != trimmedValue) {
                val replacement = nativeVariant(trimmedValue, "correction")
                chosenId = replacement.getValue("id")
                variants += replacement
                history += buildJsonObject {
                    put("at", Instant.now().toString())
                    put("action", "correction")
                }
            }
            existing[index] = JsonObject(
                prev + mapOf(
                    "label" to JsonPrimitive(trimmedLabel),
                    "agentRule" to JsonPrimitive(safeRule),
                    "chosenVariantId" to chosenId,
                    "variants" to JsonArray(variants),
                    "history" to JsonArray(history),
                ),
            )
        }
    }
    return withProfileEnvelope(JsonObject(meta + ("details" to JsonArray(existing))))
}

internal fun CipherView.removeProfileDetail(detailId: String): CipherView {
    val meta = profileEnvelope() ?: return this
    val filtered = meta.getValue("details").jsonArray
        .map { it.jsonObject }
        .filterNot { it["id"]?.jsonPrimitive?.contentOrNull == detailId }
    return withProfileEnvelope(JsonObject(meta + ("details" to JsonArray(filtered))))
}

internal fun CipherView.renameProfile(newName: String): CipherView {
    val trimmed = newName.trim()
    if (trimmed.isEmpty()) return this
    val meta = profileEnvelope() ?: return copy(name = trimmed)
    return copy(name = trimmed).withProfileEnvelope(meta)
}

internal fun CipherView.withDetailAgentRule(detailId: String, rule: String): CipherView {
    val safeRule = if (rule in setOf("fill", "ask", "never")) rule else "ask"
    val meta = profileEnvelope() ?: return this
    val updated = meta.getValue("details").jsonArray.map { el ->
        val row = el.jsonObject
        if (row["id"]?.jsonPrimitive?.contentOrNull == detailId) {
            JsonObject(row + ("agentRule" to JsonPrimitive(safeRule)))
        } else {
            row
        }
    }
    return withProfileEnvelope(JsonObject(meta + ("details" to JsonArray(updated))))
}

internal fun CipherView.itemAgentRule(defaultRule: String = "ask"): String {
    val raw = fields.orEmpty()
        .firstOrNull { it.name == "vk.agentRule" }
        ?.value?.trim()?.lowercase()
    return if (raw in setOf("fill", "ask", "never")) raw!! else defaultRule
}

internal fun CipherView.withItemAgentRule(rule: String): CipherView {
    val safeRule = if (rule in setOf("fill", "ask", "never")) rule else "ask"
    val field = FieldView("vk.agentRule", safeRule, FieldType.HIDDEN, null)
    return copy(fields = fields.orEmpty().filterNot { it.name == "vk.agentRule" } + field)
}

internal fun inferDocumentKind(details: Map<String, String>, fileName: String): String? {
    val keys = details.keys
    return when {
        keys.any { it.startsWith("id.passport.") } -> "Passport"
        keys.any { it.startsWith("id.residence_card.") } -> "Residence card"
        keys.any { it.startsWith("id.mynumber") } -> "My Number card"
        keys.any { it.startsWith("id.driver_license.") } -> "Driver's licence"
        keys.any { it.startsWith("id.national.") } -> "National ID card"
        keys.any { it.startsWith("id.health_insurance.") } -> "Health insurance card"
        keys.any { it.startsWith("id.pension.") } -> "Pension record"
        keys.any { it.startsWith("visa.") } -> "Visa"
        keys.any { it.startsWith("income.") } -> "Payslip"
        keys.any { it.startsWith("bank.") } -> "Bank statement"
        else -> {
            val lower = fileName.lowercase()
            when {
                lower.contains("passport") -> "Passport"
                lower.contains("zairyu") || lower.contains("residence") -> "Residence card"
                lower.contains("cccd") || lower.contains("citizen") || lower.contains("national") -> "National ID card"
                lower.contains("juminhyo") -> "Certificate of residence"
                lower.contains("marriage") || lower.contains("konin") -> "Marriage certificate"
                lower.contains("birth") -> "Birth certificate"
                lower.contains("payslip") || lower.contains("salary") -> "Payslip"
                lower.contains("bank") -> "Bank passbook"
                else -> null
            }
        }
    }
}

internal fun humanDocumentTitle(source: JsonObject, fallbackName: String = ""): String {
    fun polishKind(raw: String): String {
        val spaced = raw.replace('_', ' ').replace('-', ' ').replace(Regex("\\s+"), " ").trim()
        val titled = spaced.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
        return titled.replace(Regex("\\bId\\b", RegexOption.IGNORE_CASE), "ID")
    }
    val rawTitle = source["title"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    if (rawTitle.isNotEmpty() &&
        !rawTitle.equals("document", ignoreCase = true) &&
        !rawTitle.contains('_') &&
        !rawTitle.contains('-')
    ) {
        return rawTitle
    }
    val docKind = source["documentKind"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    if (docKind.isNotEmpty() && !docKind.equals("document", ignoreCase = true)) {
        return polishKind(docKind)
    }
    val kind = source["kind"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
    if (kind.isNotEmpty() && !kind.equals("document", ignoreCase = true)) {
        return polishKind(kind)
    }
    val candidate = rawTitle.ifEmpty {
        (source["fileName"]?.jsonPrimitive?.contentOrNull ?: fallbackName).substringBeforeLast('.')
    }
    inferDocumentKind(emptyMap(), candidate)?.let { return it }
    val cleaned = candidate
        .replace(Regex("^(vk_doc_|vk_form_|photo-|scanned-|document-|\\d+[-_\\s]+)", RegexOption.IGNORE_CASE), "")
        .replace('_', ' ')
        .replace('-', ' ')
        .replace(Regex("\\s+"), " ")
        .trim()
    if (cleaned.isEmpty() || cleaned.equals("document", ignoreCase = true) || cleaned.all { it.isDigit() }) {
        return "Identity document"
    }
    return polishKind(cleaned)
}

internal fun humanVariantBadge(script: String?, tag: String?): String {
    return when (script?.trim()) {
        "Latn" -> "Latin"
        "Kana" -> "Katakana"
        "Hira" -> "Hiragana"
        "Hani" -> "Kanji"
        "Jpan" -> "Japanese"
        "Hang" -> "Hangul"
        else -> when (tag?.trim()) {
            "wareki" -> "Japanese era"
            "zengin" -> "Bank format"
            null, "" -> script?.takeIf { it.isNotBlank() } ?: "Primary"
            else -> tag.replace('_', ' ').replaceFirstChar { it.titlecase() }
        }
    }
}

internal fun humanAgentRuleLabel(rule: String): String = when (rule) {
    "fill" -> "Fill without asking"
    "never" -> "Don't fill"
    else -> "Ask first"
}
