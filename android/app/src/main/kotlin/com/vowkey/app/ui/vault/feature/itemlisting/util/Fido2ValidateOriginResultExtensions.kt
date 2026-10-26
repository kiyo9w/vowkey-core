package com.vowkey.app.ui.vault.feature.itemlisting.util

import androidx.annotation.StringRes
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.data.credentials.model.ValidateOriginResult

/**
 * Returns the string resource ID corresponding to the error message for the given
 * [ValidateOriginResult.Error].
 */
val ValidateOriginResult.Error.messageResourceId: Int
    @StringRes
    get() = when (this) {
        ValidateOriginResult.Error.AssetLinkNotFound -> {
            VowkeyString.passkey_operation_failed_because_of_missing_asset_links
        }

        ValidateOriginResult.Error.PasskeyNotSupportedForApp -> {
            VowkeyString.passkeys_not_supported_for_this_app
        }

        ValidateOriginResult.Error.PrivilegedAppNotAllowed -> {
            VowkeyString.passkey_operation_failed_because_browser_is_not_privileged
        }

        ValidateOriginResult.Error.PrivilegedAppSignatureNotFound -> {
            VowkeyString.passkey_operation_failed_because_browser_signature_does_not_match
        }

        ValidateOriginResult.Error.Unknown -> {
            VowkeyString.generic_error_message
        }
    }
