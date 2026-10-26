package com.vowkey.app.ui.vault.components.model

import androidx.annotation.StringRes
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * Enumerated values to represent a create vault item option.
 */
enum class CreateVaultItemType(
    @field:StringRes val selectionText: Int,
) {
    /**
     * A login cipher.
     */
    LOGIN(VowkeyString.log_in_noun),

    /**
     * A card cipher.
     */
    CARD(VowkeyString.type_card),

    /**
     * A bank account cipher.
     */
    BANK_ACCOUNT(VowkeyString.type_bank_account),

    /**
     * An identity cipher.
     */
    IDENTITY(VowkeyString.type_identity),

    /**
     * A license cipher.
     */
    LICENSE(VowkeyString.type_license),

    /**
     * A passport cipher.
     */
    PASSPORT(VowkeyString.type_passport),

    /**
     * A secure note cipher.
     */
    SECURE_NOTE(VowkeyString.type_secure_note),

    /**
     * A cipher item folder
     */
    FOLDER(VowkeyString.folder),

    /**
     * A SSH key cipher.
     */
    SSH_KEY(VowkeyString.type_ssh_key),
}
