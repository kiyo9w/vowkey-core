package com.vowkey.app.ui.vault.util

import com.vowkey.vault.CipherType
import com.vowkey.app.ui.vault.model.VaultItemCipherType

/**
 * Converts the [CipherType] to its corresponding [VaultItemCipherType].
 */
fun CipherType.toVaultItemCipherType(): VaultItemCipherType =
    when (this) {
        CipherType.LOGIN -> VaultItemCipherType.LOGIN
        CipherType.SECURE_NOTE -> VaultItemCipherType.SECURE_NOTE
        CipherType.CARD -> VaultItemCipherType.CARD
        CipherType.IDENTITY -> VaultItemCipherType.IDENTITY
        CipherType.SSH_KEY -> VaultItemCipherType.SSH_KEY
        CipherType.BANK_ACCOUNT -> VaultItemCipherType.BANK_ACCOUNT
        CipherType.DRIVERS_LICENSE -> VaultItemCipherType.DRIVERS_LICENSE
        CipherType.PASSPORT -> VaultItemCipherType.PASSPORT
        CipherType.API_KEY, CipherType.ENVIRONMENT -> error("Use the keys and environments editor")
    }

/** Vowkey item types have their own editor, outside upstream item forms. */
fun CipherType.secretsKind(): String? = when (this) {
    CipherType.API_KEY -> "key"
    CipherType.ENVIRONMENT -> "environment"
    else -> null
}
