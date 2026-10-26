package com.vowkey.authenticator.data.platform.manager

import com.vowkey.sdk.Client

/**
 * Manages the creation, caching, and destruction of SDK [Client] instances on a per-user basis.
 */
interface SdkClientManager {

    /**
     * Returns the cached [Client] instance, otherwise creates and caches
     * a new one and returns it.
     */
    suspend fun getOrCreateClient(): Client

    /**
     * Clears any resources from the [Client] and removes it from the internal cache.
     */
    fun destroyClient()
}
