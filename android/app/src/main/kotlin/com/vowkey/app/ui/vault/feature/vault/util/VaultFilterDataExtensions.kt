package com.vowkey.app.ui.vault.feature.vault.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.feature.vault.model.VaultFilterData

/**
 * Derives an app bar title given the [VaultFilterData].
 */
fun VaultFilterData?.toAppBarTitle(): Text =
    if (this != null) {
        VowkeyString.vaults
    } else {
        VowkeyString.my_vault
    }
        .asText()
