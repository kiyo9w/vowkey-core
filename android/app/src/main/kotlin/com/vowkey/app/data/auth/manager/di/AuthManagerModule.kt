package com.vowkey.app.data.auth.manager.di

import android.content.Context
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.core.data.manager.toast.ToastManager
import com.vowkey.network.service.AccountsService
import com.vowkey.network.service.AuthRequestsService
import com.vowkey.network.service.DevicesService
import com.vowkey.network.service.NewAuthRequestService
import com.vowkey.network.service.OrganizationService
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSource
import com.vowkey.app.data.auth.manager.AddTotpItemFromAuthenticatorManager
import com.vowkey.app.data.auth.manager.AddTotpItemFromAuthenticatorManagerImpl
import com.vowkey.app.data.auth.manager.AuthRequestManager
import com.vowkey.app.data.auth.manager.AuthRequestManagerImpl
import com.vowkey.app.data.auth.manager.AuthRequestNotificationManager
import com.vowkey.app.data.auth.manager.AuthRequestNotificationManagerImpl
import com.vowkey.app.data.auth.manager.AuthStateManager
import com.vowkey.app.data.auth.manager.AuthStateManagerImpl
import com.vowkey.app.data.auth.manager.AuthTokenManager
import com.vowkey.app.data.auth.manager.AuthTokenManagerImpl
import com.vowkey.app.data.auth.manager.KdfManager
import com.vowkey.app.data.auth.manager.KdfManagerImpl
import com.vowkey.app.data.auth.manager.KeyConnectorManager
import com.vowkey.app.data.auth.manager.KeyConnectorManagerImpl
import com.vowkey.app.data.auth.manager.OrganizationManager
import com.vowkey.app.data.auth.manager.OrganizationManagerImpl
import com.vowkey.app.data.auth.manager.TrustedDeviceManager
import com.vowkey.app.data.auth.manager.TrustedDeviceManagerImpl
import com.vowkey.app.data.auth.manager.UserLogoutManager
import com.vowkey.app.data.auth.manager.UserLogoutManagerImpl
import com.vowkey.app.data.auth.manager.UserStateManager
import com.vowkey.app.data.auth.manager.UserStateManagerImpl
import com.vowkey.app.data.platform.datasource.disk.PushDiskSource
import com.vowkey.app.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.app.data.platform.manager.CredentialExchangeRegistryManager
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.FirstTimeActionManager
import com.vowkey.app.data.platform.manager.PolicyManager
import com.vowkey.app.data.platform.manager.PushManager
import com.vowkey.app.data.platform.manager.policy.UserNotificationPolicyManager
import com.vowkey.app.data.tools.generator.datasource.disk.GeneratorDiskSource
import com.vowkey.app.data.tools.generator.datasource.disk.PasswordHistoryDiskSource
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.manager.VaultLockManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides managers in the auth package.
 */
@Module
@InstallIn(SingletonComponent::class)
object AuthManagerModule {

    @Provides
    @Singleton
    fun provideAuthRequestNotificationManager(
        @ApplicationContext context: Context,
        authDiskSource: AuthDiskSource,
        pushManager: PushManager,
        dispatcherManager: DispatcherManager,
    ): AuthRequestNotificationManager =
        AuthRequestNotificationManagerImpl(
            context = context,
            authDiskSource = authDiskSource,
            pushManager = pushManager,
            dispatcherManager = dispatcherManager,
        )

    @Provides
    @Singleton
    fun provideAuthRequestManager(
        clock: Clock,
        authRequestsService: AuthRequestsService,
        newAuthRequestService: NewAuthRequestService,
        authSdkSource: AuthSdkSource,
        vaultSdkSource: VaultSdkSource,
        authDiskSource: AuthDiskSource,
        pushManager: PushManager,
    ): AuthRequestManager =
        AuthRequestManagerImpl(
            clock = clock,
            authRequestsService = authRequestsService,
            newAuthRequestService = newAuthRequestService,
            authSdkSource = authSdkSource,
            vaultSdkSource = vaultSdkSource,
            authDiskSource = authDiskSource,
            pushManager = pushManager,
        )

    @Provides
    @Singleton
    fun providesAuthStateManager(
        authDiskSource: AuthDiskSource,
        dispatcherManager: DispatcherManager,
    ): AuthStateManager = AuthStateManagerImpl(
        authDiskSource = authDiskSource,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideKeyConnectorManager(
        accountsService: AccountsService,
        authSdkSource: AuthSdkSource,
        vaultSdkSource: VaultSdkSource,
        featureFlagManager: FeatureFlagManager,
    ): KeyConnectorManager =
        KeyConnectorManagerImpl(
            accountsService = accountsService,
            authSdkSource = authSdkSource,
            vaultSdkSource = vaultSdkSource,
            featureFlagManager = featureFlagManager,
        )

    @Provides
    @Singleton
    fun provideTrustedDeviceManager(
        authDiskSource: AuthDiskSource,
        vaultSdkSource: VaultSdkSource,
        devicesService: DevicesService,
    ): TrustedDeviceManager =
        TrustedDeviceManagerImpl(
            authDiskSource = authDiskSource,
            vaultSdkSource = vaultSdkSource,
            devicesService = devicesService,
        )

    @Provides
    @Singleton
    fun provideUserLogoutManager(
        authDiskSource: AuthDiskSource,
        generatorDiskSource: GeneratorDiskSource,
        passwordHistoryDiskSource: PasswordHistoryDiskSource,
        pushDiskSource: PushDiskSource,
        settingsDiskSource: SettingsDiskSource,
        toastManager: ToastManager,
        vaultDiskSource: VaultDiskSource,
        vaultSdkSource: VaultSdkSource,
        dispatcherManager: DispatcherManager,
        credentialExchangeRegistryManager: CredentialExchangeRegistryManager,
        userNotificationPolicyManager: UserNotificationPolicyManager,
    ): UserLogoutManager =
        UserLogoutManagerImpl(
            authDiskSource = authDiskSource,
            generatorDiskSource = generatorDiskSource,
            passwordHistoryDiskSource = passwordHistoryDiskSource,
            pushDiskSource = pushDiskSource,
            settingsDiskSource = settingsDiskSource,
            toastManager = toastManager,
            vaultDiskSource = vaultDiskSource,
            vaultSdkSource = vaultSdkSource,
            dispatcherManager = dispatcherManager,
            credentialExchangeRegistryManager = credentialExchangeRegistryManager,
            userNotificationPolicyManager = userNotificationPolicyManager,
        )

    @Provides
    @Singleton
    fun providesAddTotpItemFromAuthenticatorManager(): AddTotpItemFromAuthenticatorManager =
        AddTotpItemFromAuthenticatorManagerImpl()

    @Provides
    @Singleton
    fun providesAuthTokenManager(
        authDiskSource: AuthDiskSource,
    ): AuthTokenManager = AuthTokenManagerImpl(authDiskSource = authDiskSource)

    @Provides
    @Singleton
    fun providesKdfManager(
        authDiskSource: AuthDiskSource,
        vaultSdkSource: VaultSdkSource,
        accountsService: AccountsService,
        featureFlagManager: FeatureFlagManager,
    ): KdfManager = KdfManagerImpl(
        authDiskSource = authDiskSource,
        vaultSdkSource = vaultSdkSource,
        accountsService = accountsService,
        featureFlagManager = featureFlagManager,
    )

    @Provides
    @Singleton
    fun providesOrganizationManager(
        authDiskSource: AuthDiskSource,
        organizationService: OrganizationService,
    ): OrganizationManager = OrganizationManagerImpl(
        authDiskSource = authDiskSource,
        organizationService = organizationService,
    )

    @Provides
    @Singleton
    fun providesUserStateManager(
        authDiskSource: AuthDiskSource,
        firstTimeActionManager: FirstTimeActionManager,
        vaultLockManager: VaultLockManager,
        policyManager: PolicyManager,
        dispatcherManager: DispatcherManager,
    ): UserStateManager = UserStateManagerImpl(
        authDiskSource = authDiskSource,
        firstTimeActionManager = firstTimeActionManager,
        vaultLockManager = vaultLockManager,
        policyManager = policyManager,
        dispatcherManager = dispatcherManager,
    )
}
