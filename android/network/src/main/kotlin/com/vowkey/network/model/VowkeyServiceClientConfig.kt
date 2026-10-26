package com.vowkey.network.model

import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.interceptor.AuthTokenProvider
import com.vowkey.network.interceptor.BaseUrlsProvider
import com.vowkey.network.provider.AppIdProvider
import com.vowkey.network.provider.CookieProvider
import com.vowkey.network.provider.PermissionProvider
import com.vowkey.network.ssl.CertificateProvider
import java.time.Clock

/**
 * Models configuration for [VowkeyServiceClient].
 */
data class VowkeyServiceClientConfig(
    val clientData: ClientData,
    val appIdProvider: AppIdProvider,
    val baseUrlsProvider: BaseUrlsProvider,
    val authTokenProvider: AuthTokenProvider,
    val certificateProvider: CertificateProvider,
    val cookieProvider: CookieProvider,
    val permissionProvider: PermissionProvider,
    val clock: Clock,
    val enableHttpBodyLogging: Boolean = false,
) {
    /**
     * Models data about the client application.
     */
    data class ClientData(
        val userAgent: String,
        val clientName: String,
        val clientVersion: String,
    )
}
