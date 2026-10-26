package com.vowkey.app.ui.platform.feature.rootnav.util

import com.vowkey.app.data.autofill.model.AutofillSelectionData
import com.vowkey.app.ui.vault.model.VaultItemListingType

/**
 * Derives a [VaultItemListingType] from the given [AutofillSelectionData.Type].
 */
fun AutofillSelectionData.Type.toVaultItemListingType(): VaultItemListingType =
    when (this) {
        AutofillSelectionData.Type.CARD -> VaultItemListingType.Card
        AutofillSelectionData.Type.LOGIN -> VaultItemListingType.Login
        AutofillSelectionData.Type.IDENTITY -> VaultItemListingType.Identity
    }
