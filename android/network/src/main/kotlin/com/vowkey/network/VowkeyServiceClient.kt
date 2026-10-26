@file:OmitFromCoverage

package com.vowkey.network

import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.network.model.VowkeyServiceClientConfig
import com.vowkey.network.provider.CookieProvider
import com.vowkey.network.provider.RefreshTokenProvider
import com.vowkey.network.provider.TokenProvider
import com.vowkey.network.service.AccountsService
import com.vowkey.network.service.AuthRequestsService
import com.vowkey.network.service.BillingService
import com.vowkey.network.service.CiphersService
import com.vowkey.network.service.ConfigService
import com.vowkey.network.service.DevicesService
import com.vowkey.network.service.DigitalAssetLinkService
import com.vowkey.network.service.DownloadService
import com.vowkey.network.service.EventService
import com.vowkey.network.service.FillAssistService
import com.vowkey.network.service.FolderService
import com.vowkey.network.service.HaveIBeenPwnedService
import com.vowkey.network.service.IdentityService
import com.vowkey.network.service.NewAuthRequestService
import com.vowkey.network.service.OrganizationService
import com.vowkey.network.service.PushService
import com.vowkey.network.service.SendsService
import com.vowkey.network.service.SyncService
import kotlinx.serialization.json.Json

/**
 * Provides access to Vowkey services.
 *
 * New instances of this class should be created using the [vowkeyServiceClient] factory
 * function.
 *
 * Example initialization:
 * ```
 * val vowkeyServiceClient = vowkeyServiceClient(
 *     VowkeyServiceClientConfig(
 *         clock = clock,
 *         json = json,
 *         appIdProvider = appIdProvider,
 *         clientData = VowkeyServiceClientConfig.ClientData(
 *             userAgent = "my-user-agent-string",
 *             clientName = "my-application",
 *             clientVersion = "versionName",
 *         ),
 *         authTokenProvider = authTokenProvider,
 *         baseUrlsProvider = baseUrlsProvider,
 *         certificateProvider = certificateProvider,
 *     ),
 * )
 * ```
 */
interface VowkeyServiceClient {
    /**
     * Provides access to the token provider.
     */
    val tokenProvider: TokenProvider

    /**
     * Provides access to the cookie provider.
     */
    val cookieProvider: CookieProvider

    /**
     * Provides access to the Accounts service.
     */
    val accountsService: AccountsService

    /**
     * Provides access to the Authentication Requests service.
     */
    val authRequestsService: AuthRequestsService

    /**
     * Provides access to the Billing service.
     */
    val billingService: BillingService

    /**
     * Provides access to the Ciphers service.
     */
    val ciphersService: CiphersService

    /**
     * Provides access to the Configuration service.
     */
    val configService: ConfigService

    /**
     * Provides access to the Digital Asset Link service.
     */
    val digitalAssetLinkService: DigitalAssetLinkService

    /**
     * Provides access to the Devices service.
     */
    val devicesService: DevicesService

    /**
     * Provides access to the Download service.
     */
    val downloadService: DownloadService

    /**
     * Provides access to the Event service.
     */
    val eventService: EventService

    /**
     * Provides access to the Fill-Assist service.
     */
    val fillAssistService: FillAssistService

    /**
     * Provides access to the Folder service.
     */
    val folderService: FolderService

    /**
     * Provides access to the Have I Been Pwned service.
     */
    val haveIBeenPwnedService: HaveIBeenPwnedService

    /**
     * Provides access to the Identity service.
     */
    val identityService: IdentityService

    /**
     * Provides access to the New Authentication Request service.
     */
    val newAuthRequestService: NewAuthRequestService

    /**
     * Provides access to the Organization service.
     */
    val organizationService: OrganizationService

    /**
     * Provides access to the Push service.
     */
    val pushService: PushService

    /**
     * Provides access to the Sync service.
     */
    val syncService: SyncService

    /**
     * Provides access to the Sends service.
     */
    val sendsService: SendsService

    /**
     * Sets the [refreshTokenProvider] to be used for refreshing access tokens.
     */
    fun setRefreshTokenProvider(refreshTokenProvider: RefreshTokenProvider?)
}

/**
 * Creates a [VowkeyServiceClient] with the given [config].
 *
 * Example initialization:
 * ```
 * val vowkeyServiceClient = vowkeyServiceClient(
 *     VowkeyServiceClientConfig(
 *         clock = clock,
 *         json = json,
 *         appIdProvider = appIdProvider,
 *         clientData = VowkeyServiceClientConfig.ClientData(
 *             userAgent = "my-user-agent-string",
 *             clientName = "my-application",
 *             clientVersion = "versionName",
 *         ),
 *         authTokenProvider = authTokenProvider,
 *         baseUrlsProvider = baseUrlsProvider,
 *         certificateProvider = certificateProvider,
 *     ),
 * )
 * ```
 */
fun vowkeyServiceClient(
    config: VowkeyServiceClientConfig,
    json: Json,
): VowkeyServiceClient = VowkeyServiceClientImpl(
    vowkeyServiceClientConfig = config,
    clientJson = json,
)
