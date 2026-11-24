package com.vowkey.app.data.vault.datasource.disk

import com.vowkey.vault.CipherType
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Test

class NativeProfileTest {

    @Test
    fun `detailValue falls back to current untagged variant when chosenVariantId is null`() {
        val detail = buildJsonObject {
            put("id", "detail-dob")
            put("attribute", "birth.date")
            put("chosenVariantId", JsonNull)
            put("agentRule", "fill")
            put(
                "variants",
                JsonArray(
                    listOf(
                        buildJsonObject {
                            put("id", "var-wareki")
                            put("value", "平成3年5月12日")
                            put("tag", "wareki")
                            put("current", true)
                        },
                        buildJsonObject {
                            put("id", "var-iso")
                            put("value", "1991-05-12")
                            put("tag", JsonNull)
                            put("current", true)
                        },
                    ),
                ),
            )
        }

        assertEquals("1991-05-12", detail.detailValue())
    }

    @Test
    fun `profileFlatDetails excludes details whose agentRule is never`() {
        val profile = newNativeProfile(
            name = "Trần Minh Khoa",
            values = mapOf(
                "name.full" to "Trần Minh Khoa",
                "name.full.kana" to "チャン ミン コア",
                "bank.account.number" to "0123456789",
            ),
        )
        val bankDetailId = profile.profileDetails()
            .first { it["attribute"]?.jsonPrimitive?.content == "bank.account.number" }
            .getValue("id").jsonPrimitive.content

        val restricted = profile.withDetailAgentRule(bankDetailId, "never")
        val flat = restricted.profileFlatDetails()

        assertEquals("Trần Minh Khoa", flat["name.full"])
        assertEquals("チャン ミン コア", flat["name.full.kana"])
        assertFalse(flat.containsKey("bank.account.number"))
    }

    @Test
    fun `itemAgentRule round-trips card access permission`() {
        val card = newNativeCipher(CipherType.CARD).copy(name = "Primary Visa")
        assertEquals("ask", card.itemAgentRule())

        val blocked = card.withItemAgentRule("never")
        assertEquals("never", blocked.itemAgentRule())
    }
}
