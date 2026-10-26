package com.vowkey.app.ui.vault.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.model.VaultItemCipherType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class VaultItemCipherTypeExtensionsTest {

    @Test
    fun `savedSnackbarMessage should return the correct value for each VaultItemCipherType`() {
        mapOf(
            VaultItemCipherType.LOGIN to VowkeyString.login_saved.asText(),
            VaultItemCipherType.CARD to VowkeyString.card_saved.asText(),
            VaultItemCipherType.IDENTITY to VowkeyString.identity_saved.asText(),
            VaultItemCipherType.SECURE_NOTE to VowkeyString.secure_note_saved.asText(),
            VaultItemCipherType.SSH_KEY to VowkeyString.ssh_key_saved.asText(),
            VaultItemCipherType.BANK_ACCOUNT to VowkeyString.bank_account_saved.asText(),
            VaultItemCipherType.DRIVERS_LICENSE to VowkeyString.license_saved.asText(),
            VaultItemCipherType.PASSPORT to VowkeyString.passport_saved.asText(),
        )
            .forEach { (type, message) ->
                assertEquals(
                    message,
                    type.savedSnackbarMessage,
                )
            }
    }
}
