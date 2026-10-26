package com.vowkey.authenticator.data.authenticator.repository.util

import com.vowkey.authenticator.data.authenticator.manager.model.VerificationCodeItem
import com.vowkey.authenticator.data.authenticator.repository.model.SharedVerificationCodesState

/**
 * Whether the user has enabled sync with Vowkey and the two apps are successfully
 * syncing. This is useful to know when to show certain sync UI and also when to support
 * moving codes to Vowkey.
 */
val SharedVerificationCodesState.isSyncWithVowkeyEnabled: Boolean
    get() = when (this) {
        SharedVerificationCodesState.AppNotInstalled,
        SharedVerificationCodesState.Error,
        SharedVerificationCodesState.FeatureNotEnabled,
        SharedVerificationCodesState.Loading,
        SharedVerificationCodesState.OsVersionNotSupported,
        SharedVerificationCodesState.SyncNotEnabled,
            -> false

        is SharedVerificationCodesState.Success -> true
    }

/**
 * Get a list of shared items, or empty if there are no shared items.
 */
val SharedVerificationCodesState.itemsOrEmpty: List<VerificationCodeItem>
    get() = when (this) {
        SharedVerificationCodesState.AppNotInstalled,
        SharedVerificationCodesState.Error,
        SharedVerificationCodesState.FeatureNotEnabled,
        SharedVerificationCodesState.Loading,
        SharedVerificationCodesState.OsVersionNotSupported,
        SharedVerificationCodesState.SyncNotEnabled,
            -> emptyList()

        is SharedVerificationCodesState.Success -> this.items
    }
