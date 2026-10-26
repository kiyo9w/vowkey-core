package com.vowkey.app.ui.tools.feature.send.model

import androidx.annotation.DrawableRes
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Represents the types of icons to be displayed with the send.
 */
enum class SendStatusIcon(
    @field:DrawableRes val iconRes: Int,
    val contentDescription: Text,
    val testTag: String,
) {
    DISABLED(
        iconRes = VowkeyDrawable.ic_send_disabled,
        contentDescription = VowkeyString.disabled.asText(),
        testTag = "DisabledSendIcon",
    ),
    PASSWORD(
        iconRes = VowkeyDrawable.ic_key,
        contentDescription = VowkeyString.password.asText(),
        testTag = "PasswordProtectedSendIcon",
    ),
    EXPIRED(
        iconRes = VowkeyDrawable.ic_send_expired,
        contentDescription = VowkeyString.expired.asText(),
        testTag = "ExpiredSendIcon",
    ),
    MAX_ACCESS_COUNT_REACHED(
        iconRes = VowkeyDrawable.ic_send_max_access_count_reached,
        contentDescription = VowkeyString.maximum_access_count_reached.asText(),
        testTag = "MaxAccessSendIcon",
    ),
    PENDING_DELETE(
        iconRes = VowkeyDrawable.ic_send_pending_delete,
        contentDescription = VowkeyString.pending_delete.asText(),
        testTag = "PendingDeletionSendIcon",
    ),
}
