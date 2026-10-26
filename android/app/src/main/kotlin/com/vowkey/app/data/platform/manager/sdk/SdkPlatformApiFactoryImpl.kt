package com.vowkey.app.data.platform.manager.sdk

import com.vowkey.servercommunicationconfig.ServerCommunicationConfigPlatformApi
import com.vowkey.app.data.platform.manager.CookieAcquisitionRequestManager
import com.vowkey.app.data.platform.manager.sdk.platformapi.ServerCommunicationConfigPlatformApiImpl

/**
 * Factory for creating and managing sdk platform api's.
 */
class SdkPlatformApiFactoryImpl(
    private val serverCommConfigManager: CookieAcquisitionRequestManager,
) : SdkPlatformApiFactory {
    /**
     * Retrieves or creates a [ServerCommunicationConfigPlatformApi] for use with the Vowkey SDK.
     */
    override fun getServerCommunicationConfigPlatformApi(): ServerCommunicationConfigPlatformApi =
        ServerCommunicationConfigPlatformApiImpl(
            serverCommConfigManager = serverCommConfigManager,
        )
}
