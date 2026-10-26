package com.vowkey.app.data.platform.repository.di

import android.view.autofill.AutofillManager
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.data.manager.flightrecorder.FlightRecorderManager
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.autofill.accessibility.manager.AccessibilityEnabledManager
import com.vowkey.app.data.autofill.manager.AutofillEnabledManager
import com.vowkey.app.data.platform.datasource.disk.CookieDiskSource
import com.vowkey.app.data.platform.datasource.disk.EnvironmentDiskSource
import com.vowkey.app.data.platform.datasource.disk.FeatureFlagOverrideDiskSource
import com.vowkey.app.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.app.data.platform.manager.PolicyManager
import com.vowkey.app.data.platform.repository.AuthenticatorBridgeRepository
import com.vowkey.app.data.platform.repository.AuthenticatorBridgeRepositoryImpl
import com.vowkey.app.data.platform.repository.DebugMenuRepository
import com.vowkey.app.data.platform.repository.DebugMenuRepositoryImpl
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.app.data.platform.repository.EnvironmentRepositoryImpl
import com.vowkey.app.data.platform.repository.SettingsRepository
import com.vowkey.app.data.platform.repository.SettingsRepositoryImpl
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource
import com.vowkey.app.data.vault.datasource.sdk.ScopedVaultSdkSource
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
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
    fun providesAuthenticatorBridgeRepository(
        authDiskSource: AuthDiskSource,
        vaultDiskSource: VaultDiskSource,
        scopedVaultSdkSource: ScopedVaultSdkSource,
    ): AuthenticatorBridgeRepository = AuthenticatorBridgeRepositoryImpl(
        authDiskSource = authDiskSource,
        vaultDiskSource = vaultDiskSource,
        scopedVaultSdkSource = scopedVaultSdkSource,
    )

    @Provides
    @Singleton
    fun provideEnvironmentRepository(
        environmentDiskSource: EnvironmentDiskSource,
        authDiskSource: AuthDiskSource,
        dispatcherManager: DispatcherManager,
    ): EnvironmentRepository =
        EnvironmentRepositoryImpl(
            environmentDiskSource = environmentDiskSource,
            authDiskSource = authDiskSource,
            dispatcherManager = dispatcherManager,
        )

    @Provides
    @Singleton
    fun provideSettingsRepository(
        autofillManager: AutofillManager,
        autofillEnabledManager: AutofillEnabledManager,
        authDiskSource: AuthDiskSource,
        buildInfoManager: BuildInfoManager,
        settingsDiskSource: SettingsDiskSource,
        vaultSdkSource: VaultSdkSource,
        accessibilityEnabledManager: AccessibilityEnabledManager,
        dispatcherManager: DispatcherManager,
        policyManager: PolicyManager,
        flightRecorderManager: FlightRecorderManager,
    ): SettingsRepository =
        SettingsRepositoryImpl(
            autofillManager = autofillManager,
            autofillEnabledManager = autofillEnabledManager,
            authDiskSource = authDiskSource,
            buildInfoManager = buildInfoManager,
            settingsDiskSource = settingsDiskSource,
            vaultSdkSource = vaultSdkSource,
            accessibilityEnabledManager = accessibilityEnabledManager,
            dispatcherManager = dispatcherManager,
            policyManager = policyManager,
            flightRecorderManager = flightRecorderManager,
        )

    @Provides
    @Singleton
    fun provideDebugMenuRepository(
        featureFlagOverrideDiskSource: FeatureFlagOverrideDiskSource,
        serverConfigRepository: ServerConfigRepository,
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        cookieDiskSource: CookieDiskSource,
    ): DebugMenuRepository = DebugMenuRepositoryImpl(
        featureFlagOverrideDiskSource = featureFlagOverrideDiskSource,
        serverConfigRepository = serverConfigRepository,
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        cookieDiskSource = cookieDiskSource,
    )
}
