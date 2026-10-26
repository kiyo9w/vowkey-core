@file:OmitFromCoverage

package com.vowkey.authenticator.ui.platform.util

import android.content.Intent
import androidx.core.net.toUri
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.manager.IntentManager

/**
 * Launches the Vowkey account settings.
 */
fun IntentManager.startVowkeyAccountSettings() {
    startActivity(
        Intent(
            Intent.ACTION_VIEW,
            "vowkey://settings/account_security".toUri(),
        ).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        },
    )
}
