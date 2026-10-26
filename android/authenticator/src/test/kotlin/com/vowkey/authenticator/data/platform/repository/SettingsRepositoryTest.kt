package com.vowkey.authenticator.data.platform.repository

import app.cash.turbine.test
import com.vowkey.authenticator.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.authenticator.data.platform.manager.lock.model.AppTimeout
import com.vowkey.authenticator.ui.platform.feature.settings.data.model.DefaultSaveOption
import com.vowkey.core.data.manager.dispatcher.FakeDispatcherManager
import com.vowkey.core.data.repository.util.bufferedMutableSharedFlow
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import io.mockk.verify
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class SettingsRepositoryTest {

    private val mutableAppTimeoutInMinutesFlow = MutableStateFlow<Int?>(null)
    private val settingsDiskSource: SettingsDiskSource = mockk {
        every { getAlertThresholdSeconds() } returns 7
        every { appTimeoutInMinutesFlow } returns mutableAppTimeoutInMinutesFlow
        every { appTimeoutInMinutes } answers { mutableAppTimeoutInMinutesFlow.value }
    }

    private val settingsRepository: SettingsRepository = SettingsRepositoryImpl(
        settingsDiskSource = settingsDiskSource,
        flightRecorderManager = mockk(),
        dispatcherManager = FakeDispatcherManager(),
    )

    @Test
    fun `hasUserDismissedDownloadVowkeyCard should return false when disk source is null`() {
        every { settingsDiskSource.hasUserDismissedDownloadVowkeyCard } returns null
        assertFalse(settingsRepository.hasUserDismissedDownloadVowkeyCard)
    }

    @Test
    fun `hasUserDismissedDownloadVowkeyCard should return false when disk source is false`() {
        every { settingsDiskSource.hasUserDismissedDownloadVowkeyCard } returns false
        assertFalse(settingsRepository.hasUserDismissedDownloadVowkeyCard)
    }

    @Test
    fun `hasUserDismissedDownloadVowkeyCard should return true when disk source is true`() {
        every { settingsDiskSource.hasUserDismissedDownloadVowkeyCard } returns true
        assertTrue(settingsRepository.hasUserDismissedDownloadVowkeyCard)
    }

    @Test
    fun `hasUserDismissedSyncWithVowkeyCard should return false when disk source is null`() {
        every { settingsDiskSource.hasUserDismissedSyncWithVowkeyCard } returns null
        assertFalse(settingsRepository.hasUserDismissedSyncWithVowkeyCard)
    }

    @Test
    fun `hasUserDismissedSyncWithVowkeyCard should return false when disk source is false`() {
        every { settingsDiskSource.hasUserDismissedSyncWithVowkeyCard } returns false
        assertFalse(settingsRepository.hasUserDismissedSyncWithVowkeyCard)
    }

    @Test
    fun `hasUserDismissedSyncWithVowkeyCard should return true when disk source is true`() {
        every { settingsDiskSource.hasUserDismissedSyncWithVowkeyCard } returns true
        assertTrue(settingsRepository.hasUserDismissedSyncWithVowkeyCard)
    }

    @Test
    fun `hasUserDismissedSyncWithVowkeyCard set should set disk source`() {
        every { settingsDiskSource.hasUserDismissedSyncWithVowkeyCard = true } just runs
        settingsRepository.hasUserDismissedSyncWithVowkeyCard = true
        verify { settingsRepository.hasUserDismissedSyncWithVowkeyCard = true }
    }

    @Test
    fun `defaultSaveOption should pull from and update SettingsDiskSource`() {
        // Reading from repository should read from disk source:
        every { settingsDiskSource.defaultSaveOption } returns DefaultSaveOption.NONE
        assertEquals(
            DefaultSaveOption.NONE,
            settingsRepository.defaultSaveOption,
        )
        verify { settingsDiskSource.defaultSaveOption }

        // Writing to repository should write to disk source:
        every { settingsDiskSource.defaultSaveOption = DefaultSaveOption.VOWKEY_APP } just runs
        settingsRepository.defaultSaveOption = DefaultSaveOption.VOWKEY_APP
        verify { settingsDiskSource.defaultSaveOption = DefaultSaveOption.VOWKEY_APP }
    }

    @Test
    fun `defaultSaveOptionFlow should match SettingsDiskSource`() = runTest {
        // Reading from repository should read from disk source:
        val expectedOptions = listOf(
            DefaultSaveOption.NONE,
            DefaultSaveOption.LOCAL,
            DefaultSaveOption.VOWKEY_APP,
            DefaultSaveOption.NONE,
        )
        every { settingsDiskSource.defaultSaveOptionFlow } returns flow {
            expectedOptions.forEach { emit(it) }
        }

        settingsRepository.defaultSaveOptionFlow.test {
            expectedOptions.forEach {
                assertEquals(it, awaitItem())
            }
            awaitComplete()
        }
    }

    @Test
    fun `isDynamicColorsEnabled should pull from and update SettingsDiskSource`() {
        // Reading from repository should read from disk source:
        every { settingsDiskSource.isDynamicColorsEnabled } returns null
        assertFalse(settingsRepository.isDynamicColorsEnabled)
        verify { settingsDiskSource.isDynamicColorsEnabled }

        // Writing to repository should write to disk source:
        every { settingsDiskSource.isDynamicColorsEnabled = true } just runs
        settingsRepository.isDynamicColorsEnabled = true
        verify { settingsDiskSource.isDynamicColorsEnabled = true }
    }

    @Test
    fun `isDynamicColorsEnabledFlow should match SettingsDiskSource`() = runTest {
        // Reading from repository should read from disk source:
        val mutableDynamicColorsFlow = bufferedMutableSharedFlow<Boolean?>()
        every { settingsDiskSource.isDynamicColorsEnabledFlow } returns mutableDynamicColorsFlow
        every { settingsDiskSource.isDynamicColorsEnabled } returns null

        settingsRepository.isDynamicColorsEnabledFlow.test {
            assertFalse(awaitItem())
            mutableDynamicColorsFlow.emit(true)
            assertTrue(awaitItem())
            mutableDynamicColorsFlow.emit(false)
            assertFalse(awaitItem())
            expectNoEvents()
        }
    }

    @Test
    fun `appTimeoutState should pull from and update SettingsDiskSource`() {
        // Reading from repository should read from disk source:
        assertEquals(AppTimeout.Never, settingsRepository.appTimeoutState)
        verify { settingsDiskSource.appTimeoutInMinutes }

        // Writing to repository should write to disk source:
        every { settingsDiskSource.appTimeoutInMinutes = 5 } just runs
        settingsRepository.appTimeoutState = AppTimeout.FiveMinutes
        verify { settingsDiskSource.appTimeoutInMinutes = 5 }
    }

    @Test
    fun `appTimeoutStateFlow should match SettingsDiskSource`() = runTest {
        settingsRepository.appTimeoutStateFlow.test {
            assertEquals(AppTimeout.Never, awaitItem())
            mutableAppTimeoutInMinutesFlow.emit(1)
            assertEquals(AppTimeout.OneMinute, awaitItem())
            mutableAppTimeoutInMinutesFlow.emit(240)
            assertEquals(AppTimeout.FourHours, awaitItem())
            expectNoEvents()
        }
    }

    @Test
    fun `isShowNextCodeEnabled should default to false when disk source returns null`() {
        every { settingsDiskSource.isShowNextCodeEnabled } returns null
        assertFalse(settingsRepository.isShowNextCodeEnabled)
    }

    @Test
    fun `isShowNextCodeEnabled should return disk source value when set`() {
        every { settingsDiskSource.isShowNextCodeEnabled } returns true
        assertTrue(settingsRepository.isShowNextCodeEnabled)
    }

    @Test
    fun `isShowNextCodeEnabled setter should write to disk source`() {
        every { settingsDiskSource.isShowNextCodeEnabled = true } just runs
        settingsRepository.isShowNextCodeEnabled = true
        verify { settingsDiskSource.isShowNextCodeEnabled = true }
    }

    @Test
    fun `isShowNextCodeEnabledFlow should map null to false and emit updates`() = runTest {
        val mutableShowNextCodeFlow = bufferedMutableSharedFlow<Boolean?>()
        every { settingsDiskSource.isShowNextCodeEnabledFlow } returns mutableShowNextCodeFlow
        every { settingsDiskSource.isShowNextCodeEnabled } returns null

        settingsRepository.isShowNextCodeEnabledFlow.test {
            assertFalse(awaitItem())
            mutableShowNextCodeFlow.emit(true)
            assertTrue(awaitItem())
            mutableShowNextCodeFlow.emit(false)
            assertFalse(awaitItem())
            expectNoEvents()
        }
    }

    @Test
    fun `previouslySyncedVowkeyAccountIds should pull from and update SettingsDiskSource`() {
        // Reading from repository should read from disk source:
        every { settingsDiskSource.previouslySyncedVowkeyAccountIds } returns emptySet()
        assertEquals(
            emptySet<String>(),
            settingsRepository.previouslySyncedVowkeyAccountIds,
        )
        verify { settingsDiskSource.previouslySyncedVowkeyAccountIds }

        // Writing to repository should write to disk source:
        every {
            settingsDiskSource.previouslySyncedVowkeyAccountIds = setOf("1", "2", "3")
        } just runs
        settingsRepository.previouslySyncedVowkeyAccountIds = setOf("1", "2", "3")
        verify { settingsDiskSource.previouslySyncedVowkeyAccountIds = setOf("1", "2", "3") }
    }
}
