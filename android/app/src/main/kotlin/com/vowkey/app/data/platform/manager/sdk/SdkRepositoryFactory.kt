package com.vowkey.app.data.platform.manager.sdk

import com.vowkey.core.ClientManagedTokens
import com.vowkey.core.ClientSettings
import com.vowkey.core.StateBridgeForeignImpl
import com.vowkey.sdk.Repositories
import com.vowkey.sdk.ServerCommunicationConfigRepository

/**
 * Creates and manages sdk repositories.
 */
interface SdkRepositoryFactory {
    /**
     * Creates a [StateBridgeForeignImpl] for use with the Vowkey SDK.
     */
    fun getStateBridge(userId: String): StateBridgeForeignImpl

    /**
     * Retrieves or creates a [Repositories] for use with the Vowkey SDK.
     */
    fun getRepositories(userId: String?): Repositories

    /**
     * Retrieves or creates a [ClientManagedTokens] for use with the Vowkey SDK.
     */
    fun getClientManagedTokens(
        userId: String?,
        accessToken: String?,
    ): ClientManagedTokens

    /**
     * Retrieves or creates a [ClientSettings] for use with the Vowkey SDK.
     */
    fun getClientSettings(): ClientSettings

    /**
     * Retrieves or creates a [ServerCommunicationConfigRepository] for use with the Vowkey SDK.
     */
    fun getServerCommunicationConfigRepository(): ServerCommunicationConfigRepository
}
