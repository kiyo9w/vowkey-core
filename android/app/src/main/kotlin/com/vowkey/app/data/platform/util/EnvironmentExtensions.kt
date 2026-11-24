package com.vowkey.app.data.platform.util

import com.vowkey.data.datasource.disk.model.EnvironmentUrlDataJson
import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.manager.intent.model.AuthTabData

/**
 * Creates the appropriate Duo [AuthTabData] for the given [EnvironmentUrlDataJson].
 */
val Environment.duoAuthTabData: AuthTabData get() = authTabData(kind = "duo")

/**
 * Creates the appropriate WebAuthn [AuthTabData] for the given [EnvironmentUrlDataJson].
 */
val Environment.webAuthnAuthTabData: AuthTabData get() = authTabData(kind = "webauthn")

/**
 * Creates the appropriate SSO [AuthTabData] for the given [EnvironmentUrlDataJson].
 */
val Environment.ssoAuthTabData: AuthTabData get() = authTabData(kind = "sso")

private fun Environment.authTabData(
    kind: String,
): AuthTabData = when (this) {
    is Environment.Prod.Us -> {
        AuthTabData.CustomScheme(
            callbackUrl = "vowkey://$kind-callback",
        )
    }

    is Environment.Prod.Eu -> {
        AuthTabData.HttpsScheme(
            host = "vowkey.eu",
            path = "$kind-callback",
        )
    }

    is Environment.Prod.FedRamp -> {
        AuthTabData.HttpsScheme(
            host = "vowkey-gov.com",
            path = "$kind-callback",
        )
    }

    is Environment.SelfHosted -> {
        if (this.isInternal) {
            AuthTabData.HttpsScheme(
                host = "vowkey.pw",
                path = "$kind-callback",
            )
        } else {
            AuthTabData.CustomScheme(
                callbackUrl = "vowkey://$kind-callback",
            )
        }
    }
}

/**
 * Returns the scheme used for app-links within the app.
 */
val Environment.appLinksScheme: String
    get() = when (this) {
        is Environment.Prod.Us -> "vowkey"
        is Environment.Prod -> "https"
        is Environment.SelfHosted -> if (this.isInternal) "https" else "vowkey"
    }
