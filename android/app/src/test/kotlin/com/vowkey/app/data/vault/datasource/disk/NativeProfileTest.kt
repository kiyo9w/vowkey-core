package com.vowkey.app.data.vault.datasource.disk

import com.vowkey.vault.FieldType
import com.vowkey.vault.FieldView
import kotlinx.serialization.json.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class NativeProfileTest {
    @Test
    fun `capture emits the shared envelope and groups name scripts into one detail`() {
        val profile = newNativeProfile("Profile", mapOf(
            "name.given.kanji" to "美咲", "name.given.latin" to "Misaki",
            "address.street" to "42 Main Street", "custom.membership" to "0007",
        ))
        val meta = checkNotNull(profile.profileEnvelope())
        assertEquals(profile.id, meta.getValue("profileId").jsonPrimitive.content)
        assertEquals(JsonNull, meta["relationship"])
        assertEquals("confirmed", meta.getValue("status").jsonPrimitive.content)
        val details = meta.getValue("details").jsonArray.map { it.jsonObject }
        assertEquals(3, details.size)
        val name = details.single { it["attribute"] == JsonPrimitive("name.given") }
        assertEquals(setOf("Hani", "Latn"), name.getValue("variants").jsonArray.map {
            it.jsonObject.getValue("script").jsonPrimitive.content
        }.toSet())
        assertEquals("Misaki", profile.identity?.firstName)
        assertEquals("42 Main Street", profile.identity?.address1)
        details.forEach { detail ->
            assertTrue(detail.keys.containsAll(listOf("id", "attribute", "label", "valueType", "chosenVariantId", "agentRule", "variants", "history", "conflicts")))
            detail.getValue("variants").jsonArray.forEach { entry ->
                val variant = entry.jsonObject
                assertTrue(variant.keys.containsAll(listOf("id", "script", "tag", "value", "current", "sourceId", "locator", "verified", "origin")))
                assertFalse(variant.getValue("verified").jsonPrimitive.boolean)
            }
        }
        assertEquals(FieldType.HIDDEN, profile.fields!!.single { it.name == "vk.meta" }.type)
    }

    @Test
    fun `correction retains original value and remapping retains logical ids and unknown keys`() {
        val profile = newNativeProfile("Before", mapOf("custom.membership" to "0007"))
        val originalMeta = checkNotNull(profile.profileEnvelope())
        val originalDetail = originalMeta.getValue("details").jsonArray.single().jsonObject
        val originalVariant = originalDetail.getValue("variants").jsonArray.single().jsonObject
        val detailId = originalDetail.getValue("id").jsonPrimitive.content
        val enriched = profile.withProfileEnvelope(JsonObject(originalMeta + ("futureKey" to JsonPrimitive("kept"))))
        val edited = enriched.editProfile("After", mapOf(detailId to "0008"))
        val changed = checkNotNull(edited.profileEnvelope()).getValue("details").jsonArray.single().jsonObject
        assertEquals(originalDetail["id"], changed["id"])
        assertEquals("0008", changed.detailValue())
        val historical = changed.getValue("history").jsonArray.single().jsonObject.getValue("variant").jsonObject
        assertEquals(originalVariant["id"], historical["id"])
        assertEquals("0007", historical.getValue("value").jsonPrimitive.content)
        assertFalse(historical.getValue("current").jsonPrimitive.boolean)
        val remapped = checkNotNull(edited.withPhysicalProfileId("server-id").profileEnvelope())
        assertEquals(JsonPrimitive("server-id"), remapped["profileId"])
        assertEquals(JsonPrimitive("kept"), remapped["futureKey"])
        assertEquals(changed, remapped.getValue("details").jsonArray.single())
    }

    @Test
    fun `older local capture metadata upgrades without changing detail or variant ids`() {
        val profile = newNativeProfile("Profile", emptyMap()).copy(fields = listOf(FieldView(
            "vk.meta", """{"v":1,"profileId":"old-id","kind":"person","status":"confirmed","details":[{"id":"detail-id","key":"contact.email","variants":[{"id":"variant-id","value":"a@example.test"}]}],"sources":[]}""",
            FieldType.HIDDEN, null,
        )))
        val upgraded = profile.withPhysicalProfileId("physical-id")
        val meta = checkNotNull(upgraded.profileEnvelope())
        val detail = meta.getValue("details").jsonArray.single().jsonObject
        assertEquals(JsonPrimitive("physical-id"), meta["profileId"])
        assertEquals(JsonPrimitive("detail-id"), detail["id"])
        assertEquals(JsonPrimitive("contact.email"), detail["attribute"])
        assertEquals(JsonPrimitive("variant-id"), detail["chosenVariantId"])
        assertEquals("a@example.test", upgraded.identity?.email)
    }
}
