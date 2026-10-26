package com.vowkey.app.ui.platform.feature.settings.autofill.privilegedapps.list.model

import android.os.Parcelable
import androidx.annotation.StringRes
import com.vowkey.ui.platform.resource.VowkeyString
import kotlinx.parcelize.Parcelize

/**
 * Represents a single item in the list of trusted privileged apps.
 *
 * @param packageName The package name of the privileged app.
 * @param signature The signature of the privileged app.
 */
@Parcelize
data class PrivilegedAppListItem(
    val packageName: String,
    val signature: String,
    val trustAuthority: PrivilegedAppTrustAuthority,
    val appName: String? = null,
) : Parcelable {

    val canRevokeTrust: Boolean
        get() = trustAuthority == PrivilegedAppTrustAuthority.USER

    val label: String
        get() = if (appName == null) {
            packageName
        } else {
            "$appName ($packageName)"
        }

    /**
     * Represents the trust authority of a privileged app.
     */
    enum class PrivilegedAppTrustAuthority(
        @field:StringRes val description: Int,
    ) {
        /**
         * The app is trusted by Google.
         */
        GOOGLE(description = VowkeyString.trusted_by_google),

        /**
         * The app is trusted by the Vowkey community.
         */
        COMMUNITY(description = VowkeyString.trusted_by_the_community),

        /**
         * The app is trusted by the user.
         */
        USER(description = VowkeyString.trusted_by_you),
    }
}
