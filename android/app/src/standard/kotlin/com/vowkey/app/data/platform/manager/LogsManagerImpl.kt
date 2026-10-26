package com.vowkey.app.data.platform.manager

import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.data.repository.model.Environment
import com.google.firebase.Firebase
import com.google.firebase.crashlytics.crashlytics
import com.vowkey.app.BuildConfig
import com.vowkey.app.data.platform.datasource.disk.legacy.LegacyAppCenterMigrator
import com.vowkey.app.data.platform.repository.SettingsRepository
import timber.log.Timber

/**
 * [LogsManager] implementation for standard flavor builds.
 */
@OmitFromCoverage
class LogsManagerImpl(
    private val settingsRepository: SettingsRepository,
    legacyAppCenterMigrator: LegacyAppCenterMigrator,
) : LogsManager {

    private val nonfatalErrorTree: NonfatalErrorTree = NonfatalErrorTree()

    override var isEnabled: Boolean
        get() = settingsRepository.isCrashLoggingEnabled
        set(value) {
            settingsRepository.isCrashLoggingEnabled = value
            Firebase.crashlytics.isCrashlyticsCollectionEnabled = value
            if (value) {
                Timber.plant(nonfatalErrorTree)
            } else if (Timber.forest().contains(nonfatalErrorTree)) {
                Timber.uproot(nonfatalErrorTree)
            }
        }

    override fun setUserData(userId: String?, environmentType: Environment.Type) {
        Firebase.crashlytics.setUserId(userId.orEmpty())
        Firebase.crashlytics.setCustomKey(
            if (userId == null) "PreAuthRegion" else "Region",
            environmentType.toString(),
        )
    }

    override fun trackNonFatalException(throwable: Throwable) {
        if (isEnabled) {
            Firebase.crashlytics.recordException(throwable)
        }
    }

    init {
        legacyAppCenterMigrator.migrateIfNecessary()
        if (BuildConfig.HAS_LOGS_ENABLED) {
            Timber.plant(Timber.DebugTree())
        }
        isEnabled = settingsRepository.isCrashLoggingEnabled
    }

    private inner class NonfatalErrorTree : Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            t?.let { trackNonFatalException(VowkeyNonfatalException(message, it)) }
        }
    }
}

private class VowkeyNonfatalException(
    message: String,
    throwable: Throwable,
) : Exception(message, throwable)
