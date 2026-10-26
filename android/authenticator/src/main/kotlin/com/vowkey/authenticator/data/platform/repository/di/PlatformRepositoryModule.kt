package com.vowkey.authenticator.data.platform.repository.di

import com.vowkey.authenticator.data.platform.datasource.disk.FeatureFlagOverrideDiskSource
import com.vowkey.authenticator.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.authenticator.data.platform.repository.DebugMenuRepository
import com.vowkey.authenticator.data.platform.repository.DebugMenuRepositoryImpl
import com.vowkey.authenticator.data.platform.repository.SettingsRepository
import com.vowkey.authenticator.data.platform.repository.SettingsRepositoryImpl
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.data.manager.flightrecorder.FlightRecorderManager
import com.vowkey.data.repository.ServerConfigRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides repositories in the auth package.
 */
@Module
@InstallIn(SingletonComponent::class)
object PlatformRepositoryModule {

    @Provides
    @Singleton
    fun provideSettingsRepository(
        settingsDiskSource: SettingsDiskSource,
        flightRecorderManager: FlightRecorderManager,
        dispatcherManager: DispatcherManager,
    ): SettingsRepository =
        SettingsRepositoryImpl(
            settingsDiskSource = settingsDiskSource,
            flightRecorderManager = flightRecorderManager,
            dispatcherManager = dispatcherManager,
        )

    @Provides
    @Singleton
    fun provideDebugMenuRepository(
        featureFlagOverrideDiskSource: FeatureFlagOverrideDiskSource,
        serverConfigRepository: ServerConfigRepository,
    ): DebugMenuRepository = DebugMenuRepositoryImpl(
        featureFlagOverrideDiskSource = featureFlagOverrideDiskSource,
        serverConfigRepository = serverConfigRepository,
    )
}
