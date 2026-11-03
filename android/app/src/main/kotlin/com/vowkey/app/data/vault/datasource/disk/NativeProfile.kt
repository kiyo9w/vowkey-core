package com.vowkey.app.data.vault.datasource.disk

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
    val field = fields.orEmpty().singleOrNull { it.name == "vk.meta" } ?: return null
    val meta = Json.parseToJsonElement(field.value ?: return null).jsonObject
    check(meta["v"] == JsonPrimitive(1)) { "Update Vowkey to edit this profile." }
    check(meta["details"] is JsonArray && meta["sources"] is JsonArray) { "Couldn't read this profile's details." }
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
    return JsonObject(mapOf("relationship" to JsonNull) + meta + ("details" to JsonArray(details)))
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
    "address.prefecture" to "Prefecture or state",
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
    val words = attribute.replace(Regex("[._]"), " ").trim()
    return if (words.isEmpty()) words else words[0].uppercaseChar() + words.substring(1)
}

internal fun humanDetailLabel(attribute: String?, label: String? = null): String {
    if (attribute != null && attribute in CANONICAL_DETAIL_LABELS) {
        if (label.isNullOrBlank() || label == attribute || label == mechanicalAttributeLabel(attribute)) {
            return CANONICAL_DETAIL_LABELS.getValue(attribute)
        }
    }
    if (!label.isNullOrBlank()) {
        return if (attribute != null && label == attribute) mechanicalAttributeLabel(attribute) else label
    }
    return if (attribute != null) CANONICAL_DETAIL_LABELS[attribute] ?: mechanicalAttributeLabel(attribute) else ""
}
