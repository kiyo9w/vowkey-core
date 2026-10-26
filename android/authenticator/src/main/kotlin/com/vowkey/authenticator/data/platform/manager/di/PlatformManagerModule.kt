package com.vowkey.authenticator.data.platform.manager.di

import android.content.Context
import com.vowkey.authenticator.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.authenticator.data.authenticator.datasource.disk.AuthenticatorDiskSource
import com.vowkey.authenticator.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.authenticator.data.platform.manager.BiometricsEncryptionManager
import com.vowkey.authenticator.data.platform.manager.BiometricsEncryptionManagerImpl
import com.vowkey.authenticator.data.platform.manager.VowkeyEncodingManager
import com.vowkey.authenticator.data.platform.manager.VowkeyEncodingManagerImpl
import com.vowkey.authenticator.data.platform.manager.CrashLogsManager
import com.vowkey.authenticator.data.platform.manager.CrashLogsManagerImpl
import com.vowkey.authenticator.data.platform.manager.DebugMenuFeatureFlagManagerImpl
import com.vowkey.authenticator.data.platform.manager.FeatureFlagManager
import com.vowkey.authenticator.data.platform.manager.FeatureFlagManagerImpl
import com.vowkey.authenticator.data.platform.manager.SdkClientManager
import com.vowkey.authenticator.data.platform.manager.SdkClientManagerImpl
import com.vowkey.authenticator.data.platform.manager.clipboard.VowkeyClipboardManager
import com.vowkey.authenticator.data.platform.manager.clipboard.VowkeyClipboardManagerImpl
import com.vowkey.authenticator.data.platform.manager.imports.ImportManager
import com.vowkey.authenticator.data.platform.manager.imports.ImportManagerImpl
import com.vowkey.authenticator.data.platform.manager.lock.AppLockManager
import com.vowkey.authenticator.data.platform.manager.lock.AppLockManagerImpl
import com.vowkey.authenticator.data.platform.repository.DebugMenuRepository
import com.vowkey.authenticator.data.platform.repository.SettingsRepository
import com.vowkey.core.data.manager.UuidManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManagerImpl
import com.vowkey.core.data.manager.realtime.RealtimeManager
import com.vowkey.core.data.manager.realtime.RealtimeManagerImpl
import com.vowkey.core.data.manager.toast.ToastManager
import com.vowkey.core.data.manager.toast.ToastManagerImpl
import com.vowkey.data.manager.appstate.AppStateManager
import com.vowkey.data.repository.ServerConfigRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides managers in the platform package.
 */
@Module
@InstallIn(SingletonComponent::class)
object PlatformManagerModule {

    @Provides
    @Singleton
    fun provideAppLockManager(
        appStateManager: AppStateManager,
        realtimeManager: RealtimeManager,
        settingsRepository: SettingsRepository,
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        dispatcherManager: DispatcherManager,
        @ApplicationContext context: Context,
    ): AppLockManager = AppLockManagerImpl(
        appStateManager = appStateManager,
        realtimeManager = realtimeManager,
        settingsRepository = settingsRepository,
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        dispatcherManager = dispatcherManager,
        context = context,
    )

    @Provides
    @Singleton
    fun provideVowkeyClipboardManager(
        @ApplicationContext context: Context,
        toastManager: ToastManager,
    ): VowkeyClipboardManager = VowkeyClipboardManagerImpl(
        context = context,
        toastManager = toastManager,
    )

    @Provides
    @Singleton
    fun provideRealtimeManager(): RealtimeManager = RealtimeManagerImpl()

    @Provides
    @Singleton
    fun provideToastManager(
        @ApplicationContext context: Context,
    ): ToastManager = ToastManagerImpl(
        context = context,
    )

    @Provides
    @Singleton
    fun provideVowkeyDispatchers(): DispatcherManager = DispatcherManagerImpl()

    @Provides
    @Singleton
    fun provideSdkClientManager(): SdkClientManager = SdkClientManagerImpl()

    @Provides
    @Singleton
    fun provideBiometricsEncryptionManager(
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
    ): BiometricsEncryptionManager = BiometricsEncryptionManagerImpl(
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
    )

    @Provides
    @Singleton
    fun provideCrashLogsManager(settingsRepository: SettingsRepository): CrashLogsManager =
        CrashLogsManagerImpl(
            settingsRepository = settingsRepository,
        )

    @Provides
    @Singleton
    fun provideImportManager(
        authenticatorDiskSource: AuthenticatorDiskSource,
        uuidManager: UuidManager,
    ): ImportManager = ImportManagerImpl(
        authenticatorDiskSource = authenticatorDiskSource,
        uuidManager = uuidManager,
    )

    @Provides
    @Singleton
    fun provideEncodingManager(): VowkeyEncodingManager = VowkeyEncodingManagerImpl()

    @Provides
    @Singleton
    fun providesFeatureFlagManager(
        debugMenuRepository: DebugMenuRepository,
        serverConfigRepository: ServerConfigRepository,
    ): FeatureFlagManager = if (debugMenuRepository.isDebugMenuEnabled) {
        DebugMenuFeatureFlagManagerImpl(
            debugMenuRepository = debugMenuRepository,
            defaultFeatureFlagManager = FeatureFlagManagerImpl(
                serverConfigRepository = serverConfigRepository,
            ),
        )
    } else {
        FeatureFlagManagerImpl(
            serverConfigRepository = serverConfigRepository,
        )
    }
}
