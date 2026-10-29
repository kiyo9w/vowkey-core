package com.vowkey.app.ui.vault.feature.secrets

import com.vowkey.app.data.vault.datasource.disk.newNativeCipher
import com.vowkey.vault.ApiKeyView
import com.vowkey.vault.CipherType
import com.vowkey.vault.EnvironmentMember
import com.vowkey.vault.FieldType
import com.vowkey.vault.FieldView
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

class SecretsTest {
    @Test
    fun `environment stores key ids from canonical references and preserves metadata`() {
        val meta = FieldView("vk.meta", """{"v":1,"profileRef":{"cipherId":"profile-id"}}""", FieldType.HIDDEN, null)
        val item = newNativeCipher(CipherType.ENVIRONMENT).copy(fields = listOf(meta))
        val saved = item.edited("environment", "Tools", "SERVICE_KEY=@vk:key-id/key.value", "", "")
        assertEquals(listOf(EnvironmentMember("SERVICE_KEY", "key-id")), saved.environment?.members)
        assertEquals(item.fields, saved.fields)
        assertThrows(IllegalStateException::class.java) {
            item.edited("environment", "Tools", "SERVICE_KEY=plaintext-secret", "", "")
        }
    }

    @Test
    fun `key edit preserves the authorization configuration required by its send style`() {
        val item = newNativeCipher(CipherType.API_KEY).copy(apiKey = ApiKeyView(
            "old", "header", listOf("api.example.test"), "X-Api-Key", null,
        ))
        val saved = item.edited("key", "Service", "new", "header", "api.example.test")
        assertEquals("new", saved.apiKey?.value)
        assertEquals("X-Api-Key", saved.apiKey?.headerName)
        assertEquals(listOf("api.example.test"), saved.apiKey?.allowedHosts)
    }
}
