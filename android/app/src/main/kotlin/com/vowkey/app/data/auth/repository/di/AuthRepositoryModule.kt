package com.vowkey.app.data.auth.repository.di

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.core.data.manager.toast.ToastManager
import com.vowkey.data.datasource.disk.ConfigDiskSource
import com.vowkey.network.service.AccountsService
import com.vowkey.network.service.DevicesService
import com.vowkey.network.service.HaveIBeenPwnedService
import com.vowkey.network.service.IdentityService
import com.vowkey.network.service.OrganizationService
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSource
import com.vowkey.app.data.auth.manager.AuthRequestManager
import com.vowkey.app.data.auth.manager.AuthStateManager
import com.vowkey.app.data.auth.manager.KdfManager
import com.vowkey.app.data.auth.manager.KeyConnectorManager
import com.vowkey.app.data.auth.manager.OrganizationManager
import com.vowkey.app.data.auth.manager.TrustedDeviceManager
import com.vowkey.app.data.auth.manager.UserLogoutManager
import com.vowkey.app.data.auth.manager.UserStateManager
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.AuthRepositoryImpl
import com.vowkey.app.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.app.data.platform.manager.BiometricsEncryptionManager
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.LogsManager
import com.vowkey.app.data.platform.manager.PushManager
import com.vowkey.app.data.platform.manager.policy.PasswordPolicyManager
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.app.data.platform.repository.SettingsRepository
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.repository.VaultRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides repositories in the auth package.
 */
@Module
@InstallIn(SingletonComponent::class)
object AuthRepositoryModule {

    @Provides
    @Singleton
    fun providesAuthRepository(
        clock: Clock,
        accountsService: AccountsService,
        devicesService: DevicesService,
        identityService: IdentityService,
        haveIBeenPwnedService: HaveIBeenPwnedService,
        organizationService: OrganizationService,
        authSdkSource: AuthSdkSource,
        vaultSdkSource: VaultSdkSource,
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        configDiskSource: ConfigDiskSource,
        dispatcherManager: DispatcherManager,
        environmentRepository: EnvironmentRepository,
        settingsRepository: SettingsRepository,
        vaultRepository: VaultRepository,
        biometricsEncryptionManager: BiometricsEncryptionManager,
        keyConnectorManager: KeyConnectorManager,
        authRequestManager: AuthRequestManager,
        trustedDeviceManager: TrustedDeviceManager,
        userLogoutManager: UserLogoutManager,
        pushManager: PushManager,
        passwordPolicyManager: PasswordPolicyManager,
        logsManager: LogsManager,
        userStateManager: UserStateManager,
        kdfManager: KdfManager,
        toastManager: ToastManager,
        featureFlagManager: FeatureFlagManager,
        organizationManager: OrganizationManager,
        authStateManager: AuthStateManager,
    ): AuthRepository = AuthRepositoryImpl(
        clock = clock,
        accountsService = accountsService,
        devicesService = devicesService,
        identityService = identityService,
        organizationService = organizationService,
        authSdkSource = authSdkSource,
        vaultSdkSource = vaultSdkSource,
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        configDiskSource = configDiskSource,
        haveIBeenPwnedService = haveIBeenPwnedService,
        dispatcherManager = dispatcherManager,
        environmentRepository = environmentRepository,
        settingsRepository = settingsRepository,
        vaultRepository = vaultRepository,
        biometricsEncryptionManager = biometricsEncryptionManager,
        keyConnectorManager = keyConnectorManager,
        authRequestManager = authRequestManager,
        trustedDeviceManager = trustedDeviceManager,
        userLogoutManager = userLogoutManager,
        pushManager = pushManager,
        passwordPolicyManager = passwordPolicyManager,
        logsManager = logsManager,
        userStateManager = userStateManager,
        kdfManager = kdfManager,
        toastManager = toastManager,
        featureFlagManager = featureFlagManager,
        organizationManager = organizationManager,
        authStateManager = authStateManager,
    )
}
