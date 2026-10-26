package com.vowkey.app.ui.vault.model

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Defines all available title options for identities.
 */
enum class VaultIdentityTitle(val value: Text) {
    SELECT(value = VowkeyString.select.asText()),
    MR(value = VowkeyString.mr.asText()),
    MRS(value = VowkeyString.mrs.asText()),
    MS(value = VowkeyString.ms.asText()),
    MX(value = VowkeyString.mx.asText()),
    DR(value = VowkeyString.dr.asText()),
}
