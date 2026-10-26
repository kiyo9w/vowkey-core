package com.vowkey.authenticator.data.authenticator.repository.util

import com.vowkey.authenticator.data.authenticator.repository.model.SharedVerificationCodesState
import io.mockk.mockk
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SharedVerificationCodesStateExtensionsTest {

    @Test
    @Suppress("MaxLineLength")
    fun `isSyncWithVowkeyEnabled should return true only when SharedVerificationCodesState is Success `() {
        assertFalse(SharedVerificationCodesState.AppNotInstalled.isSyncWithVowkeyEnabled)
        assertFalse(SharedVerificationCodesState.Error.isSyncWithVowkeyEnabled)
        assertFalse(SharedVerificationCodesState.FeatureNotEnabled.isSyncWithVowkeyEnabled)
        assertFalse(SharedVerificationCodesState.Loading.isSyncWithVowkeyEnabled)
        assertFalse(SharedVerificationCodesState.OsVersionNotSupported.isSyncWithVowkeyEnabled)
        assertFalse(SharedVerificationCodesState.SyncNotEnabled.isSyncWithVowkeyEnabled)
        assertTrue(SharedVerificationCodesState.Success(emptyList()).isSyncWithVowkeyEnabled)
    }

    @Test
    @Suppress("MaxLineLength")
    fun `itemsOrEmpty should return a non empty list only when state is Success `() {
        assertTrue(SharedVerificationCodesState.AppNotInstalled.itemsOrEmpty.isEmpty())
        assertTrue(SharedVerificationCodesState.Error.itemsOrEmpty.isEmpty())
        assertTrue(SharedVerificationCodesState.FeatureNotEnabled.itemsOrEmpty.isEmpty())
        assertTrue(SharedVerificationCodesState.Loading.itemsOrEmpty.isEmpty())
        assertTrue(SharedVerificationCodesState.OsVersionNotSupported.itemsOrEmpty.isEmpty())
        assertTrue(SharedVerificationCodesState.SyncNotEnabled.itemsOrEmpty.isEmpty())
        assertFalse(
            SharedVerificationCodesState.Success(
                listOf(mockk()),
            ).itemsOrEmpty.isEmpty(),
        )
    }
}
