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
        JsonObject(buildJsonObject {
            put("attribute", detail["key"] ?: JsonNull)
            put("label", detail["key"] ?: detail["attribute"] ?: JsonPrimitive("Detail"))
            put("valueType", "text"); put("chosenVariantId", variants.firstOrNull()?.get("id") ?: JsonNull)
            put("agentRule", "ask"); put("history", JsonArray(emptyList())); put("conflicts", JsonArray(emptyList()))
        } + detail + ("variants" to JsonArray(variants)))
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
                put("label", attribute); put("valueType", valueType(attribute))
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
