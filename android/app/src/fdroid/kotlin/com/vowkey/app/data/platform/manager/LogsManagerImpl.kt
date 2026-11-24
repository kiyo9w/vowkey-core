package com.vowkey.app.data.platform.manager

import android.content.Context
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.model.Environment
import com.vowkey.app.BuildConfig
import com.vowkey.app.data.platform.datasource.disk.legacy.LegacyAppCenterMigrator
import com.vowkey.app.data.platform.repository.SettingsRepository
import timber.log.Timber
import javax.inject.Inject

/**
 * F-Droid builds send no crash reports.
 */
class LogsManagerImpl @Inject constructor(
    @Suppress("UnusedPrivateProperty") context: Context,
    @Suppress("UnusedPrivateProperty") settingsRepository: SettingsRepository,
    @Suppress("UnusedPrivateProperty") serverConfigRepository: ServerConfigRepository,
    @Suppress("UnusedPrivateProperty") legacyAppCenterMigrator: LegacyAppCenterMigrator,
    @Suppress("UnusedPrivateProperty") dispatcherManager: DispatcherManager,
) : LogsManager {
    init {
        if (BuildConfig.HAS_LOGS_ENABLED) Timber.plant(Timber.DebugTree())
    }

    override var isEnabled: Boolean = false

    override fun setUserData(userId: String?, environmentType: Environment.Type) = Unit

    override fun trackNonFatalException(throwable: Throwable) = Unit
}
