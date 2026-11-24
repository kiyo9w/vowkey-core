package com.vowkey.app

import android.app.Application
import coil3.ImageLoader
import coil3.PlatformContext
import coil3.SingletonImageLoader
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.data.manager.flightrecorder.FlightRecorderManager
import com.vowkey.app.data.auth.manager.AuthRequestNotificationManager
import com.vowkey.app.data.autofill.manager.FillAssistManager
import com.vowkey.app.data.platform.datasource.disk.legacy.DiskSourceMigrationLogger
import com.vowkey.app.data.platform.manager.LogsManager
import com.vowkey.app.data.platform.manager.UsageCountManager
import com.vowkey.app.data.platform.manager.event.OrganizationEventManager
import com.vowkey.app.data.platform.manager.network.NetworkConfigManager
import com.vowkey.app.data.platform.manager.restriction.RestrictionManager
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import dagger.Lazy
import dagger.hilt.android.HiltAndroidApp
import timber.log.Timber
import javax.inject.Inject

/**
 * Custom application class.
 */
@OmitFromCoverage
@HiltAndroidApp
class VowkeyApplication : Application(), SingletonImageLoader.Factory {
    // Inject classes here that must be triggered on startup but are not otherwise consumed by
    // other callers.
    @Inject
    lateinit var flightRecorder: FlightRecorderManager

    @Inject
    lateinit var logsManager: LogsManager

    @Inject
    lateinit var usageCountManager: UsageCountManager

    @Inject
    lateinit var diskSourceMigrationLogger: DiskSourceMigrationLogger

    @Inject
    lateinit var fillAssistManager: FillAssistManager

    @Inject
    lateinit var networkConfigManager: NetworkConfigManager

    @Inject
    lateinit var authRequestNotificationManager: AuthRequestNotificationManager

    @Inject
    lateinit var organizationEventManager: OrganizationEventManager

    @Inject
    lateinit var restrictionManager: RestrictionManager

    @Inject
    lateinit var environmentRepository: EnvironmentRepository

    @Inject
    lateinit var imageLoader: Lazy<ImageLoader>

    override fun onCreate() {
        super.onCreate()
        // These must be initialized in order to ensure that the restrictionManager does not
        // override the environmentRepository values.
        restrictionManager.initialize()
        environmentRepository.initialize()
        usageCountManager.appOpened()
    }

    override fun onLowMemory() {
        super.onLowMemory()
        Timber.w("onLowMemory")
    }

    override fun newImageLoader(context: PlatformContext): ImageLoader = imageLoader.get()
}
