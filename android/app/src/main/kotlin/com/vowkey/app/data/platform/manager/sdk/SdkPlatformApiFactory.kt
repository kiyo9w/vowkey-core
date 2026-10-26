package com.vowkey.app.data.platform.manager.sdk

import com.vowkey.servercommunicationconfig.ServerCommunicationConfigPlatformApi

/**
 * Creates and manages sdk platform api's.
 */
interface SdkPlatformApiFactory {

    /**
     * Retrieves or creates a [ServerCommunicationConfigPlatformApi] for use with the Vowkey SDK.
     */
    fun getServerCommunicationConfigPlatformApi(): ServerCommunicationConfigPlatformApi
}
