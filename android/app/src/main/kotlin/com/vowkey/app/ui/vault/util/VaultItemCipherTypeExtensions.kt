package com.vowkey.app.ui.vault.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.model.VaultItemCipherType

/**
 * The message to display in a snackbar after a cipher of this type is saved.
 */
val VaultItemCipherType.savedSnackbarMessage: Text
    get() = when (this) {
        VaultItemCipherType.LOGIN -> VowkeyString.login_saved.asText()
        VaultItemCipherType.CARD -> VowkeyString.card_saved.asText()
        VaultItemCipherType.IDENTITY -> VowkeyString.identity_saved.asText()
        VaultItemCipherType.SECURE_NOTE -> VowkeyString.secure_note_saved.asText()
        VaultItemCipherType.SSH_KEY -> VowkeyString.ssh_key_saved.asText()
        VaultItemCipherType.BANK_ACCOUNT -> VowkeyString.bank_account_saved.asText()
        VaultItemCipherType.DRIVERS_LICENSE -> VowkeyString.license_saved.asText()
        VaultItemCipherType.PASSPORT -> VowkeyString.passport_saved.asText()
    }
