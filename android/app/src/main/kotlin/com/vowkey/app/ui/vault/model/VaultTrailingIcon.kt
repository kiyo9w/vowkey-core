package com.vowkey.app.ui.vault.model

import androidx.annotation.DrawableRes
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Represents the icons displayed after the cipher name.
 */
enum class VaultTrailingIcon(
    @field:DrawableRes val iconRes: Int,
    val contentDescription: Text,
    val testTag: String,
) {
    COLLECTION(
        iconRes = VowkeyDrawable.ic_shared_folder,
        contentDescription = VowkeyString.shared_folders.asText(),
        testTag = "CipherInCollectionIcon",
    ),

    /**
     * Pre-VFO-1 variant of [COLLECTION], selected when the `vfo1-foundation` feature flag is
     * disabled. This entry should be removed, along with all of its call sites, once the flag
     * is fully rolled out.
     */
    COLLECTION_LEGACY(
        iconRes = VowkeyDrawable.ic_collections,
        contentDescription = VowkeyString.collections.asText(),
        testTag = "CipherInCollectionIcon",
    ),
    ATTACHMENT(
        iconRes = VowkeyDrawable.ic_paperclip,
        contentDescription = VowkeyString.attachments.asText(),
        testTag = "CipherWithAttachmentsIcon",
    ),
}
