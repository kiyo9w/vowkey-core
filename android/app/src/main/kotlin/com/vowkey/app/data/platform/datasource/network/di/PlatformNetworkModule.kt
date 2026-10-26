package com.vowkey.app.data.platform.datasource.network.di

import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.vowkeyServiceClient
import com.vowkey.network.interceptor.BaseUrlsProvider
import com.vowkey.network.model.VowkeyServiceClientConfig
import com.vowkey.network.service.ConfigService
import com.vowkey.network.service.EventService
import com.vowkey.network.service.FillAssistService
import com.vowkey.network.service.PushService
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.auth.manager.AuthTokenManager
import com.vowkey.app.data.platform.datasource.network.util.HEADER_VALUE_CLIENT_NAME
import com.vowkey.app.data.platform.datasource.network.util.HEADER_VALUE_CLIENT_VERSION
import com.vowkey.app.data.platform.datasource.network.util.HEADER_VALUE_USER_AGENT
import com.vowkey.app.data.platform.manager.CertificateManager
import com.vowkey.app.data.platform.manager.network.NetworkCookieManager
import com.vowkey.app.data.platform.manager.network.NetworkPermissionManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import java.time.Clock
import javax.inject.Singleton

/**
 * This class provides network-related functionality for the application.
 * It initializes and configures the networking components.
 */
@Module
@InstallIn(SingletonComponent::class)
object PlatformNetworkModule {

    @Provides
    @Singleton
    fun providesFillAssistService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): FillAssistService = vowkeyServiceClient.fillAssistService

    @Provides
    @Singleton
    fun providesConfigService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): ConfigService = vowkeyServiceClient.configService

    @Provides
    @Singleton
    fun providesEventService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): EventService = vowkeyServiceClient.eventService

    @Provides
    @Singleton
    fun providePushService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): PushService = vowkeyServiceClient.pushService

    @Provides
    @Singleton
    fun provideVowkeyServiceClientConfig(
        authTokenManager: AuthTokenManager,
        baseUrlsProvider: BaseUrlsProvider,
        authDiskSource: AuthDiskSource,
        certificateManager: CertificateManager,
        buildInfoManager: BuildInfoManager,
        networkCookieManager: NetworkCookieManager,
        networkPermissionManager: NetworkPermissionManager,
        clock: Clock,
    ): VowkeyServiceClientConfig = VowkeyServiceClientConfig(
        clock = clock,
        appIdProvider = authDiskSource,
        clientData = VowkeyServiceClientConfig.ClientData(
            userAgent = HEADER_VALUE_USER_AGENT,
            clientName = HEADER_VALUE_CLIENT_NAME,
            clientVersion = HEADER_VALUE_CLIENT_VERSION,
        ),
        authTokenProvider = authTokenManager,
        baseUrlsProvider = baseUrlsProvider,
        certificateProvider = certificateManager,
        enableHttpBodyLogging = buildInfoManager.isDevBuild,
        cookieProvider = networkCookieManager,
        permissionProvider = networkPermissionManager,
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
}
