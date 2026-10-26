package com.vowkey.app.data.platform.manager.sdk

import com.vowkey.core.ClientManagedTokens
import com.vowkey.core.ClientSettings
import com.vowkey.core.DeviceType
import com.vowkey.core.StateBridgeForeignImpl
import com.vowkey.data.datasource.disk.ConfigDiskSource
import com.vowkey.network.model.VowkeyServiceClientConfig
import com.vowkey.sdk.Repositories
import com.vowkey.sdk.ServerCommunicationConfigRepository
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.platform.datasource.disk.CookieDiskSource
import com.vowkey.app.data.platform.manager.sdk.repository.SdkCipherRepository
import com.vowkey.app.data.platform.manager.sdk.repository.SdkLocalUserDataKeyStateRepository
import com.vowkey.app.data.platform.manager.sdk.repository.SdkTokenRepository
import com.vowkey.app.data.platform.manager.sdk.repository.ServerCommunicationConfigRepositoryImpl
import com.vowkey.app.data.platform.manager.sdk.statebridge.SdkStateBridge
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource

/**
 * The default implementation for the [SdkRepositoryFactory].
 */
class SdkRepositoryFactoryImpl(
    private val vaultDiskSource: VaultDiskSource,
    private val cookieDiskSource: CookieDiskSource,
    private val configDiskSource: ConfigDiskSource,
    private val authDiskSource: AuthDiskSource,
    private val serviceClientConfig: VowkeyServiceClientConfig,
) : SdkRepositoryFactory {
    override fun getStateBridge(
        userId: String,
    ): StateBridgeForeignImpl =
        SdkStateBridge(
            userId = userId,
            authDiskSource = authDiskSource,
        )

    override fun getRepositories(userId: String?): Repositories =
        Repositories(
            cipher = getSdkCipherRepository(userId = userId),
            folder = null,
            localUserDataKeyState = SdkLocalUserDataKeyStateRepository(
                authDiskSource = authDiskSource,
            ),
            organization = null,
            organizationSharedKey = null,
            policy = null,
            send = null,
        )

    override fun getClientManagedTokens(
        userId: String?,
        accessToken: String?,
    ): ClientManagedTokens =
        SdkTokenRepository(
            userId = userId,
            accessToken = accessToken,
            authDiskSource = authDiskSource,
        )

    override fun getClientSettings(): ClientSettings =
        ClientSettings(
            identityUrl = serviceClientConfig.baseUrlsProvider.getBaseIdentityUrl(),
            apiUrl = serviceClientConfig.baseUrlsProvider.getBaseApiUrl(),
            userAgent = serviceClientConfig.clientData.userAgent,
            deviceType = DeviceType.ANDROID,
            deviceIdentifier = serviceClientConfig.appIdProvider.uniqueAppId,
            vowkeyClientVersion = serviceClientConfig.clientData.clientVersion,
            vowkeyPackageType = null,
        )

    override fun getServerCommunicationConfigRepository(): ServerCommunicationConfigRepository =
        ServerCommunicationConfigRepositoryImpl(
            cookieDiskSource = cookieDiskSource,
            configDiskSource = configDiskSource,
        )

    private fun getSdkCipherRepository(
        userId: String?,
    ): SdkCipherRepository? = userId?.let {
        SdkCipherRepository(userId = it, vaultDiskSource = vaultDiskSource)
    }
}
