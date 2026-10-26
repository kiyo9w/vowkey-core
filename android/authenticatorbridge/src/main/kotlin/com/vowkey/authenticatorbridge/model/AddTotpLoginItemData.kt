package com.vowkey.authenticatorbridge.model

/**
 * Domain level model for a TOTP item to be added to the Vowkey app.
 *
 * @param totpUri A TOTP code URI to be added to the Vowkey app.
 */
data class AddTotpLoginItemData(
    val totpUri: String,
)
