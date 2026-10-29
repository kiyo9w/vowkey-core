package com.vowkey.app.data.platform.manager.ciphermatching

import com.vowkey.vault.CipherListView

/**
 * A manager for matching ciphers based on special criteria.
 */
interface CipherMatchingManager {
    /**
     * Filter [cipherListViews] for entries that match the [matchUri] in some fashion.
     */
    suspend fun filterCiphersForMatches(
        cipherListViews: List<CipherListView>,
        matchUri: String,
    ): List<CipherListView>

    suspend fun filterGuestCiphersForMatches(
        cipherListViews: List<CipherListView>,
        matchUri: String,
    ): List<CipherListView>
}
