package com.vowkey.network

import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.network.api.AgentApi
import com.vowkey.network.interceptor.AuthTokenManager
import com.vowkey.network.interceptor.BaseUrlInterceptors
import com.vowkey.network.interceptor.CookieInterceptor
import com.vowkey.network.interceptor.DeviceIdentifierInterceptor
import com.vowkey.network.interceptor.HeadersInterceptor
import com.vowkey.network.interceptor.PermissionInterceptor
import com.vowkey.network.model.VowkeyServiceClientConfig
import com.vowkey.network.provider.CookieProvider
import com.vowkey.network.provider.RefreshTokenProvider
import com.vowkey.network.provider.TokenProvider
import com.vowkey.network.retrofit.Retrofits
import com.vowkey.network.retrofit.RetrofitsImpl
import com.vowkey.network.service.AccountsServiceImpl
import com.vowkey.network.service.AuthRequestsService
import com.vowkey.network.service.AuthRequestsServiceImpl
import com.vowkey.network.service.BillingService
import com.vowkey.network.service.BillingServiceImpl
import com.vowkey.network.service.CiphersService
import com.vowkey.network.service.CiphersServiceImpl
import com.vowkey.network.service.ConfigService
import com.vowkey.network.service.ConfigServiceImpl
import com.vowkey.network.service.DevicesService
import com.vowkey.network.service.DevicesServiceImpl
import com.vowkey.network.service.DigitalAssetLinkService
import com.vowkey.network.service.DigitalAssetLinkServiceImpl
import com.vowkey.network.service.DownloadService
import com.vowkey.network.service.DownloadServiceImpl
import com.vowkey.network.service.EventService
import com.vowkey.network.service.EventServiceImpl
import com.vowkey.network.service.FillAssistService
import com.vowkey.network.service.FillAssistServiceImpl
import com.vowkey.network.service.FolderService
import com.vowkey.network.service.FolderServiceImpl
import com.vowkey.network.service.HaveIBeenPwnedService
import com.vowkey.network.service.HaveIBeenPwnedServiceImpl
import com.vowkey.network.service.IdentityService
import com.vowkey.network.service.IdentityServiceImpl
import com.vowkey.network.service.NewAuthRequestService
import com.vowkey.network.service.NewAuthRequestServiceImpl
import com.vowkey.network.service.OrganizationService
import com.vowkey.network.service.OrganizationServiceImpl
import com.vowkey.network.service.PushService
import com.vowkey.network.service.PushServiceImpl
import com.vowkey.network.service.SendsServiceImpl
import com.vowkey.network.service.SyncServiceImpl
import kotlinx.serialization.json.Json
import retrofit2.create

/**
 * Primary implementation of [VowkeyServiceClient].
 */
@OmitFromCoverage
internal class VowkeyServiceClientImpl(
    private val vowkeyServiceClientConfig: VowkeyServiceClientConfig,
    private val clientJson: Json,
) : VowkeyServiceClient {

    private val authTokenManager: AuthTokenManager = AuthTokenManager(
        clock = vowkeyServiceClientConfig.clock,
        authTokenProvider = vowkeyServiceClientConfig.authTokenProvider,
    )
    override val tokenProvider: TokenProvider = authTokenManager

    override val cookieProvider: CookieProvider = vowkeyServiceClientConfig.cookieProvider

    private val retrofits: Retrofits by lazy {
        RetrofitsImpl(
            authTokenManager = authTokenManager,
            baseUrlInterceptors = BaseUrlInterceptors(
                baseUrlsProvider = vowkeyServiceClientConfig.baseUrlsProvider,
            ),
            cookieInterceptor = CookieInterceptor(
                cookieProvider = cookieProvider,
            ),
            deviceIdentifierInterceptor = DeviceIdentifierInterceptor(
                appIdProvider = vowkeyServiceClientConfig.appIdProvider,
            ),
            permissionInterceptor = PermissionInterceptor(
                permissionProvider = vowkeyServiceClientConfig.permissionProvider,
            ),
            headersInterceptor = HeadersInterceptor(
                userAgent = vowkeyServiceClientConfig.clientData.userAgent,
                clientName = vowkeyServiceClientConfig.clientData.clientName,
                clientVersion = vowkeyServiceClientConfig.clientData.clientVersion,
            ),
            logHttpBody = vowkeyServiceClientConfig.enableHttpBodyLogging,
            certificateProvider = vowkeyServiceClientConfig.certificateProvider,
            json = clientJson,
        )
    }

    override val agentApi: AgentApi by lazy { retrofits.authenticatedApiRetrofit.create() }

    override val accountsService by lazy {
        AccountsServiceImpl(
            unauthenticatedAccountsApi = retrofits.unauthenticatedApiRetrofit.create(),
            authenticatedAccountsApi = retrofits.authenticatedApiRetrofit.create(),
            unauthenticatedKeyConnectorApi = retrofits.createStaticRetrofit().create(),
            authenticatedKeyConnectorApi = retrofits
                .createStaticRetrofit(isAuthenticated = true)
                .create(),
            json = clientJson,
        )
    }

    override val authRequestsService: AuthRequestsService by lazy {
        AuthRequestsServiceImpl(
            authenticatedAuthRequestsApi = retrofits.authenticatedApiRetrofit.create(),
        )
    }

    override val billingService: BillingService by lazy {
        BillingServiceImpl(
            authenticatedBillingApi = retrofits.authenticatedApiRetrofit.create(),
        )
    }

    override val ciphersService: CiphersService by lazy {
        CiphersServiceImpl(
            azureApi = retrofits.createStaticRetrofit().create(),
            ciphersApi = retrofits.authenticatedApiRetrofit.create(),
            json = clientJson,
            clock = vowkeyServiceClientConfig.clock,
        )
    }

    override val configService: ConfigService by lazy {
        ConfigServiceImpl(
            configApi = retrofits.authenticatedApiRetrofit.create(),
        )
    }

    override val devicesService: DevicesService by lazy {
        DevicesServiceImpl(
            authenticatedDevicesApi = retrofits.authenticatedApiRetrofit.create(),
            unauthenticatedDevicesApi = retrofits.unauthenticatedApiRetrofit.create(),
        )
    }

    override val digitalAssetLinkService: DigitalAssetLinkService by lazy {
        DigitalAssetLinkServiceImpl(
            digitalAssetLinkApi = retrofits
                .createStaticRetrofit(baseUrl = "https://digitalassetlinks.googleapis.com/")
                .create(),
        )
    }

    override val downloadService: DownloadService by lazy {
        DownloadServiceImpl(downloadApi = retrofits.createStaticRetrofit().create())
    }

    override val eventService: EventService by lazy {
        EventServiceImpl(
            organizationEventsApi = retrofits.authenticatedEventsRetrofit.create(),
            countsApi = retrofits.unauthenticatedApiRetrofit.create(),
        )
    }

    override val folderService: FolderService by lazy {
        FolderServiceImpl(
            foldersApi = retrofits.authenticatedApiRetrofit.create(),
            json = clientJson,
        )
    }

    override val fillAssistService: FillAssistService by lazy {
        FillAssistServiceImpl(api = retrofits.fillAssistRetrofit.create())
    }

    override val haveIBeenPwnedService: HaveIBeenPwnedService by lazy {
        HaveIBeenPwnedServiceImpl(
            api = retrofits
                .createStaticRetrofit(baseUrl = "https://api.pwnedpasswords.com")
                .create(),
        )
    }

    override val identityService: IdentityService by lazy {
        IdentityServiceImpl(
            unauthenticatedIdentityApi = retrofits.unauthenticatedIdentityRetrofit.create(),
            json = clientJson,
        )
    }

    override val newAuthRequestService: NewAuthRequestService by lazy {
        NewAuthRequestServiceImpl(
            authenticatedAuthRequestsApi = retrofits.authenticatedApiRetrofit.create(),
            unauthenticatedAuthRequestsApi = retrofits.unauthenticatedApiRetrofit.create(),
        )
    }

    override val organizationService: OrganizationService by lazy {
        OrganizationServiceImpl(
            authenticatedOrganizationApi = retrofits.authenticatedApiRetrofit.create(),
            unauthenticatedOrganizationApi = retrofits.unauthenticatedApiRetrofit.create(),
        )
    }

    override val pushService: PushService by lazy {
        PushServiceImpl(
            pushApi = retrofits.authenticatedApiRetrofit.create(),
            appId = vowkeyServiceClientConfig.appIdProvider.uniqueAppId,
        )
    }

    override val sendsService by lazy {
        SendsServiceImpl(
            sendsApi = retrofits.authenticatedApiRetrofit.create(),
            azureApi = retrofits.createStaticRetrofit().create(),
            json = clientJson,
            clock = vowkeyServiceClientConfig.clock,
        )
    }

    override val syncService by lazy {
        SyncServiceImpl(
            syncApi = retrofits.authenticatedApiRetrofit.create(),
        )
    }

    override fun setRefreshTokenProvider(refreshTokenProvider: RefreshTokenProvider?) {
        authTokenManager.refreshTokenProvider = refreshTokenProvider
    }
}
