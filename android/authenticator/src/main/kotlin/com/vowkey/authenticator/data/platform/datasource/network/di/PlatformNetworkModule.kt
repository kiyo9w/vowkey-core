package com.vowkey.authenticator.data.platform.datasource.network.di

import com.vowkey.authenticator.BuildConfig
import com.vowkey.authenticator.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.authenticator.data.platform.datasource.network.util.HEADER_VALUE_CLIENT_NAME
import com.vowkey.authenticator.data.platform.datasource.network.util.HEADER_VALUE_CLIENT_VERSION
import com.vowkey.authenticator.data.platform.datasource.network.util.HEADER_VALUE_USER_AGENT
import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.vowkeyServiceClient
import com.vowkey.network.interceptor.AuthTokenProvider
import com.vowkey.network.interceptor.BaseUrlsProvider
import com.vowkey.network.model.AuthTokenData
import com.vowkey.network.model.VowkeyServiceClientConfig
import com.vowkey.network.model.NetworkCookie
import com.vowkey.network.provider.CookieProvider
import com.vowkey.network.provider.PermissionProvider
import com.vowkey.network.service.ConfigService
import com.vowkey.network.service.DownloadService
import com.vowkey.network.ssl.CertificateProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import java.net.Socket
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.time.Clock
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
/**
 * This class provides network-related functionality for the application.
 * It initializes and configures the networking components.
 */
object PlatformNetworkModule {
    @Provides
    @Singleton
    fun providesConfigService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): ConfigService = vowkeyServiceClient.configService

    @Provides
    @Singleton
    fun provideVowkeyServiceClientConfig(
        baseUrlsProvider: BaseUrlsProvider,
        authDiskSource: AuthDiskSource,
        clock: Clock,
    ): VowkeyServiceClientConfig =
        VowkeyServiceClientConfig(
            clock = clock,
            appIdProvider = authDiskSource,
            clientData = VowkeyServiceClientConfig.ClientData(
                userAgent = HEADER_VALUE_USER_AGENT,
                clientName = HEADER_VALUE_CLIENT_NAME,
                clientVersion = HEADER_VALUE_CLIENT_VERSION,
            ),
            baseUrlsProvider = baseUrlsProvider,
            enableHttpBodyLogging = BuildConfig.DEBUG,
            authTokenProvider = object : AuthTokenProvider {
                override fun getAuthTokenDataOrNull(): AuthTokenData? = null

                override fun getAuthTokenDataOrNull(userId: String): AuthTokenData? = null
            },
            certificateProvider = object : CertificateProvider {
                override fun chooseClientAlias(
                    keyType: Array<out String>?,
                    issuers: Array<out Principal>?,
                    socket: Socket?,
                ): String = ""

                override fun getCertificateChain(alias: String?): Array<X509Certificate>? = null

                override fun getPrivateKey(alias: String?): PrivateKey? = null
            },
            cookieProvider = object : CookieProvider {
                override val errorMessageString: String get() = "Error"

                override fun needsBootstrap(hostname: String): Boolean = false

                override fun getCookies(hostname: String): List<NetworkCookie> = emptyList()

                override fun acquireCookies(hostname: String): Unit = Unit
            },
            permissionProvider = object : PermissionProvider {
                override val errorMessageString: String get() = "Error"

                override val hasLocalNetworkAccessPermission: Boolean get() = false

                override fun acquireLocalNetworkAccessPermission(): Unit = Unit
            },
        )

    @Provides
    @Singleton
    fun provideVowkeyServiceClient(
        serviceClientConfig: VowkeyServiceClientConfig,
        json: Json,
    ): VowkeyServiceClient = vowkeyServiceClient(
        config = serviceClientConfig,
        json = json,
    )

    @Provides
    @Singleton
    fun provideDownloadService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): DownloadService = vowkeyServiceClient.downloadService
}
