package com.vowkey.authenticator.ui.platform.components.listitem.model

import android.os.Parcelable
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import kotlinx.parcelize.Parcelize

/**
 * The data for the verification code item to display.
 */
@Parcelize
data class VerificationCodeDisplayItem(
    val id: String,
    val title: String,
    val subtitle: String?,
    val timeLeftSeconds: Int,
    val periodSeconds: Int,
    val alertThresholdSeconds: Int,
    val authCode: String,
    val nextAuthCode: String? = null,
    val startIcon: IconData = IconData.Local(
        iconRes = VowkeyDrawable.ic_login_item,
        testTag = "VowkeyIcon",
    ),
    val favorite: Boolean,
    val showOverflow: Boolean,
    val showMoveToVowkey: Boolean,
) : Parcelable
