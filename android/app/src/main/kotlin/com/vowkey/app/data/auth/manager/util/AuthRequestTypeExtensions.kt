package com.vowkey.app.data.auth.manager.util

import com.vowkey.network.model.AuthRequestTypeJson
import com.vowkey.app.data.auth.manager.model.AuthRequestType

/**
 * Indicates if the given [AuthRequestType] uses SSO authentication.
 */
val AuthRequestType.isSso: Boolean
    get() = when (this) {
        AuthRequestType.OTHER_DEVICE -> false
        AuthRequestType.SSO_OTHER_DEVICE,
        AuthRequestType.SSO_ADMIN_APPROVAL,
            -> true
    }

/**
 * Converts the [AuthRequestType] to the appropriate [AuthRequestTypeJson].
 */
fun AuthRequestType.toAuthRequestTypeJson(): AuthRequestTypeJson =
    when (this) {
        AuthRequestType.OTHER_DEVICE,
        AuthRequestType.SSO_OTHER_DEVICE,
            -> AuthRequestTypeJson.LOGIN_WITH_DEVICE

        AuthRequestType.SSO_ADMIN_APPROVAL -> AuthRequestTypeJson.ADMIN_APPROVAL
    }
