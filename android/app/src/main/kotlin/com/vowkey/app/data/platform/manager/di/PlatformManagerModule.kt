package com.vowkey.app.data.platform.manager.di

import android.app.Application
import android.content.Context
import androidx.core.content.getSystemService
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManagerImpl
import com.vowkey.core.data.manager.realtime.RealtimeManager
import com.vowkey.core.data.manager.realtime.RealtimeManagerImpl
import com.vowkey.core.data.manager.toast.ToastManager
import com.vowkey.core.data.manager.toast.ToastManagerImpl
import com.vowkey.cxf.registry.CredentialExchangeRegistry
import com.vowkey.cxf.registry.dsl.credentialExchangeRegistry
import com.vowkey.data.datasource.disk.ConfigDiskSource
import com.vowkey.data.manager.NativeLibraryManager
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.model.VowkeyServiceClientConfig
import com.vowkey.network.service.EventService
import com.vowkey.network.service.PushService
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSource
import com.vowkey.app.data.auth.manager.AddTotpItemFromAuthenticatorManager
import com.vowkey.app.data.auth.manager.AuthStateManager
import com.vowkey.app.data.auth.manager.OrganizationManager
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.autofill.accessibility.manager.AccessibilityEnabledManager
import com.vowkey.app.data.autofill.manager.AutofillEnabledManager
import com.vowkey.app.data.autofill.manager.browser.BrowserThirdPartyAutofillEnabledManager
import com.vowkey.app.data.platform.datasource.disk.CookieDiskSource
import com.vowkey.app.data.platform.datasource.disk.EventDiskSource
import com.vowkey.app.data.platform.datasource.disk.PushDiskSource
import com.vowkey.app.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.app.data.platform.datasource.disk.legacy.LegacyAppCenterMigrator
import com.vowkey.app.data.platform.manager.AppResumeManager
import com.vowkey.app.data.platform.manager.AppResumeManagerImpl
import com.vowkey.app.data.platform.manager.AssetManager
import com.vowkey.app.data.platform.manager.AssetManagerImpl
import com.vowkey.app.data.platform.manager.BiometricsEncryptionManager
import com.vowkey.app.data.platform.manager.BiometricsEncryptionManagerImpl
import com.vowkey.app.data.platform.manager.CertificateManager
import com.vowkey.app.data.platform.manager.CertificateManagerImpl
import com.vowkey.app.data.platform.manager.CookieAcquisitionRequestManager
import com.vowkey.app.data.platform.manager.CookieAcquisitionRequestManagerImpl
import com.vowkey.app.data.platform.manager.CredentialExchangeRegistryManager
import com.vowkey.app.data.platform.manager.CredentialExchangeRegistryManagerImpl
import com.vowkey.app.data.platform.manager.DatabaseSchemeManager
import com.vowkey.app.data.platform.manager.DatabaseSchemeManagerImpl
import com.vowkey.app.data.platform.manager.DebugMenuFeatureFlagManagerImpl
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.FeatureFlagManagerImpl
import com.vowkey.app.data.platform.manager.FirstTimeActionManager
import com.vowkey.app.data.platform.manager.FirstTimeActionManagerImpl
import com.vowkey.app.data.platform.manager.LogsManager
import com.vowkey.app.data.platform.manager.LogsManagerImpl
import com.vowkey.app.data.platform.manager.PolicyManager
import com.vowkey.app.data.platform.manager.PolicyManagerImpl
import com.vowkey.app.data.platform.manager.PushManager
import com.vowkey.app.data.platform.manager.PushManagerImpl
import com.vowkey.app.data.platform.manager.ResourceCacheManager
import com.vowkey.app.data.platform.manager.ResourceCacheManagerImpl
import com.vowkey.app.data.platform.manager.ReviewPromptManager
import com.vowkey.app.data.platform.manager.ReviewPromptManagerImpl
import com.vowkey.app.data.platform.manager.SdkClientManager
import com.vowkey.app.data.platform.manager.SdkClientManagerImpl
import com.vowkey.app.data.platform.manager.ciphermatching.CipherMatchingManager
import com.vowkey.app.data.platform.manager.ciphermatching.CipherMatchingManagerImpl
import com.vowkey.app.data.platform.manager.clipboard.VowkeyClipboardManager
import com.vowkey.app.data.platform.manager.clipboard.VowkeyClipboardManagerImpl
import com.vowkey.app.data.platform.manager.event.OrganizationEventManager
import com.vowkey.app.data.platform.manager.event.OrganizationEventManagerImpl
import com.vowkey.app.data.platform.manager.garbage.GarbageCollectionManager
import com.vowkey.app.data.platform.manager.garbage.GarbageCollectionManagerImpl
import com.vowkey.app.data.platform.manager.keyrotation.KeyRotationManager
import com.vowkey.app.data.platform.manager.keyrotation.KeyRotationManagerImpl
import com.vowkey.app.data.platform.manager.log.SettingsLogManager
import com.vowkey.app.data.platform.manager.log.SettingsLogManagerImpl
import com.vowkey.app.data.platform.manager.network.NetworkConfigManager
import com.vowkey.app.data.platform.manager.network.NetworkConfigManagerImpl
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManager
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManagerImpl
import com.vowkey.app.data.platform.manager.network.NetworkCookieManager
import com.vowkey.app.data.platform.manager.network.NetworkCookieManagerImpl
import com.vowkey.app.data.platform.manager.network.NetworkPermissionManager
import com.vowkey.app.data.platform.manager.network.NetworkPermissionManagerImpl
import com.vowkey.app.data.platform.manager.policy.PasswordPolicyManager
import com.vowkey.app.data.platform.manager.policy.PasswordPolicyManagerImpl
import com.vowkey.app.data.platform.manager.policy.UserNotificationPolicyManager
import com.vowkey.app.data.platform.manager.policy.UserNotificationPolicyManagerImpl
import com.vowkey.app.data.platform.manager.restriction.RestrictionManager
import com.vowkey.app.data.platform.manager.restriction.RestrictionManagerImpl
import com.vowkey.app.data.platform.manager.sdk.SdkPlatformApiFactory
import com.vowkey.app.data.platform.manager.sdk.SdkPlatformApiFactoryImpl
import com.vowkey.app.data.platform.manager.sdk.SdkRepositoryFactory
import com.vowkey.app.data.platform.manager.sdk.SdkRepositoryFactoryImpl
import com.vowkey.app.data.platform.manager.sdk.log.SdkLoggerFactory
import com.vowkey.app.data.platform.manager.sdk.log.SdkLoggerFactoryImpl
import com.vowkey.app.data.platform.processor.AuthenticatorBridgeProcessor
import com.vowkey.app.data.platform.processor.AuthenticatorBridgeProcessorImpl
import com.vowkey.app.data.platform.repository.AuthenticatorBridgeRepository
import com.vowkey.app.data.platform.repository.DebugMenuRepository
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.app.data.platform.repository.SettingsRepository
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.manager.VaultLockManager
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.ui.platform.manager.resource.ResourceManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides managers in the platform package.
 */
@Module
@InstallIn(SingletonComponent::class)
object PlatformManagerModule {

    @Provides
    @Singleton
    fun provideAuthenticatorBridgeProcessor(
        authenticatorBridgeRepository: AuthenticatorBridgeRepository,
        addTotpItemFromAuthenticatorManager: AddTotpItemFromAuthenticatorManager,
        @ApplicationContext context: Context,
        dispatcherManager: DispatcherManager,
    ): AuthenticatorBridgeProcessor = AuthenticatorBridgeProcessorImpl(
        authenticatorBridgeRepository = authenticatorBridgeRepository,
        addTotpItemFromAuthenticatorManager = addTotpItemFromAuthenticatorManager,
        context = context,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideOrganizationEventManager(
        authStateManager: AuthStateManager,
        organizationManager: OrganizationManager,
        vaultRepository: VaultRepository,
        authDiskSource: AuthDiskSource,
        clock: Clock,
        dispatcherManager: DispatcherManager,
        eventDiskSource: EventDiskSource,
        eventService: EventService,
    ): OrganizationEventManager = OrganizationEventManagerImpl(
        authStateManager = authStateManager,
        authDiskSource = authDiskSource,
        organizationManager = organizationManager,
        vaultRepository = vaultRepository,
        clock = clock,
        dispatcherManager = dispatcherManager,
        eventDiskSource = eventDiskSource,
        eventService = eventService,
    )

    @Provides
    @Singleton
    fun providesCipherMatchingManager(
        resourceCacheManager: ResourceCacheManager,
        settingsRepository: SettingsRepository,
        vaultRepository: VaultRepository,
    ): CipherMatchingManager =
        CipherMatchingManagerImpl(
            resourceCacheManager = resourceCacheManager,
            settingsRepository = settingsRepository,
            vaultRepository = vaultRepository,
        )

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
    fun provideVowkeyClipboardManager(
        @ApplicationContext context: Context,
        settingsRepository: SettingsRepository,
        toastManager: ToastManager,
    ): VowkeyClipboardManager = VowkeyClipboardManagerImpl(
        context = context,
        settingsRepository = settingsRepository,
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
    fun provideGarbageCollectionManager(
        dispatcherManager: DispatcherManager,
    ): GarbageCollectionManager = GarbageCollectionManagerImpl(
        dispatcherManager = dispatcherManager,
    )

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

    @Provides
    @Singleton
    fun provideSdkClientManager(
        dispatcherManager: DispatcherManager,
        featureFlagManager: FeatureFlagManager,
        nativeLibraryManager: NativeLibraryManager,
        sdkRepositoryFactory: SdkRepositoryFactory,
        sdkPlatformApiFactory: SdkPlatformApiFactory,
        sdkLoggerFactory: SdkLoggerFactory,
    ): SdkClientManager = SdkClientManagerImpl(
        dispatcherManager = dispatcherManager,
        featureFlagManager = featureFlagManager,
        nativeLibraryManager = nativeLibraryManager,
        sdkRepoFactory = sdkRepositoryFactory,
        sdkPlatformApiFactory = sdkPlatformApiFactory,
        sdkLoggerFactory = sdkLoggerFactory,
    )

    @Provides
    @Singleton
    fun provideNetworkConfigManager(
        authRepository: AuthRepository,
        environmentRepository: EnvironmentRepository,
        serverConfigRepository: ServerConfigRepository,
        vowkeyServiceClient: VowkeyServiceClient,
        dispatcherManager: DispatcherManager,
    ): NetworkConfigManager =
        NetworkConfigManagerImpl(
            authRepository = authRepository,
            environmentRepository = environmentRepository,
            serverConfigRepository = serverConfigRepository,
            vowkeyServiceClient = vowkeyServiceClient,
            dispatcherManager = dispatcherManager,
        )

    @Provides
    @Singleton
    fun provideNetworkConnectionManager(
        application: Application,
        dispatcherManager: DispatcherManager,
    ): NetworkConnectionManager = NetworkConnectionManagerImpl(
        context = application.applicationContext,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun providePolicyManager(
        authDiskSource: AuthDiskSource,
        authSdkSource: AuthSdkSource,
        featureFlagManager: FeatureFlagManager,
    ): PolicyManager = PolicyManagerImpl(
        authDiskSource = authDiskSource,
        authSdkSource = authSdkSource,
        featureFlagManager = featureFlagManager,
    )

    @Provides
    @Singleton
    fun providePasswordPolicyManager(
        authDiskSource: AuthDiskSource,
        authSdkSource: AuthSdkSource,
        policyManager: PolicyManager,
    ): PasswordPolicyManager = PasswordPolicyManagerImpl(
        authDiskSource = authDiskSource,
        authSdkSource = authSdkSource,
        policyManager = policyManager,
    )

    @Provides
    @Singleton
    fun provideUserNotificationPolicyManager(
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        policyManager: PolicyManager,
        dispatcherManager: DispatcherManager,
    ): UserNotificationPolicyManager = UserNotificationPolicyManagerImpl(
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        policyManager = policyManager,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun providePushManager(
        authDiskSource: AuthDiskSource,
        pushDiskSource: PushDiskSource,
        pushService: PushService,
        dispatcherManager: DispatcherManager,
        clock: Clock,
        json: Json,
        featureFlagManager: FeatureFlagManager,
    ): PushManager = PushManagerImpl(
        authDiskSource = authDiskSource,
        pushDiskSource = pushDiskSource,
        pushService = pushService,
        dispatcherManager = dispatcherManager,
        clock = clock,
        json = json,
        featureFlagManager = featureFlagManager,
    )

    @Provides
    @Singleton
    fun provideLogsManager(
        legacyAppCenterMigrator: LegacyAppCenterMigrator,
        settingsRepository: SettingsRepository,
    ): LogsManager = LogsManagerImpl(
        settingsRepository = settingsRepository,
        legacyAppCenterMigrator = legacyAppCenterMigrator,
    )

    @Provides
    @Singleton
    fun provideAssetManager(
        @ApplicationContext context: Context,
        dispatcherManager: DispatcherManager,
    ): AssetManager = AssetManagerImpl(
        context = context,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideRestrictionManager(
        @ApplicationContext context: Context,
        environmentRepository: EnvironmentRepository,
    ): RestrictionManager = RestrictionManagerImpl(
        environmentRepository = environmentRepository,
        restrictionsManager = requireNotNull(context.getSystemService()),
    )

    @Provides
    @Singleton
    fun provideResourceCacheManager(
        @ApplicationContext context: Context,
    ): ResourceCacheManager = ResourceCacheManagerImpl(context = context)

    @Provides
    @Singleton
    fun provideFirstTimeActionManager(
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        vaultDiskSource: VaultDiskSource,
        dispatcherManager: DispatcherManager,
        autofillEnabledManager: AutofillEnabledManager,
        thirdPartyAutofillEnabledManager: BrowserThirdPartyAutofillEnabledManager,
    ): FirstTimeActionManager = FirstTimeActionManagerImpl(
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        vaultDiskSource = vaultDiskSource,
        dispatcherManager = dispatcherManager,
        autofillEnabledManager = autofillEnabledManager,
        thirdPartyAutofillEnabledManager = thirdPartyAutofillEnabledManager,
    )

    @Provides
    @Singleton
    fun provideDatabaseSchemeManager(
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
    ): DatabaseSchemeManager = DatabaseSchemeManagerImpl(
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
    )

    @Provides
    @Singleton
    fun provideReviewPromptManager(
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        autofillEnabledManager: AutofillEnabledManager,
        accessibilityEnabledManager: AccessibilityEnabledManager,
    ): ReviewPromptManager = ReviewPromptManagerImpl(
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        autofillEnabledManager = autofillEnabledManager,
        accessibilityEnabledManager = accessibilityEnabledManager,
    )

    @Provides
    @Singleton
    fun provideSdkRepositoryFactory(
        vaultDiskSource: VaultDiskSource,
        cookieDiskSource: CookieDiskSource,
        configDiskSource: ConfigDiskSource,
        authDiskSource: AuthDiskSource,
        serviceClientConfig: VowkeyServiceClientConfig,
    ): SdkRepositoryFactory = SdkRepositoryFactoryImpl(
        vaultDiskSource = vaultDiskSource,
        cookieDiskSource = cookieDiskSource,
        configDiskSource = configDiskSource,
        authDiskSource = authDiskSource,
        serviceClientConfig = serviceClientConfig,
    )

    @Provides
    @Singleton
    fun provideSdkPlatformApiFactory(
        serverCommConfigManager: CookieAcquisitionRequestManager,
    ): SdkPlatformApiFactory = SdkPlatformApiFactoryImpl(
        serverCommConfigManager = serverCommConfigManager,
    )

    @Provides
    @Singleton
    fun provideSdkLoggerFactory(
        buildInfoManager: BuildInfoManager,
    ): SdkLoggerFactory = SdkLoggerFactoryImpl(
        buildInfoManager = buildInfoManager,
    )

    @Provides
    @Singleton
    fun provideKeyManager(
        @ApplicationContext context: Context,
        environmentRepository: EnvironmentRepository,
    ): CertificateManager = CertificateManagerImpl(
        context = context,
        environmentRepository = environmentRepository,
    )

    @Provides
    @Singleton
    fun provideAppResumeManager(
        settingsDiskSource: SettingsDiskSource,
        authDiskSource: AuthDiskSource,
        authRepository: AuthRepository,
        vaultLockManager: VaultLockManager,
        clock: Clock,
    ): AppResumeManager {
        return AppResumeManagerImpl(
            settingsDiskSource = settingsDiskSource,
            authDiskSource = authDiskSource,
            authRepository = authRepository,
            vaultLockManager = vaultLockManager,
            clock = clock,
        )
    }

    @Provides
    @Singleton
    fun provideCredentialExchangeRegistry(
        application: Application,
    ): CredentialExchangeRegistry = credentialExchangeRegistry(
        application = application,
    )

    @Provides
    @Singleton
    fun provideCredentialExchangeRegistryManager(
        credentialExchangeRegistry: CredentialExchangeRegistry,
        settingsDiskSource: SettingsDiskSource,
    ): CredentialExchangeRegistryManager = CredentialExchangeRegistryManagerImpl(
        credentialExchangeRegistry = credentialExchangeRegistry,
        settingsDiskSource = settingsDiskSource,
    )

    @Provides
    @Singleton
    fun provideServerCommunicationConfigManager(): CookieAcquisitionRequestManager =
        CookieAcquisitionRequestManagerImpl()

    @Provides
    @Singleton
    fun provideNetworkCookieManager(
        resourceManager: ResourceManager,
        configDiskSource: ConfigDiskSource,
        cookieDiskSource: CookieDiskSource,
        cookieAcquisitionRequestManager: CookieAcquisitionRequestManager,
    ): NetworkCookieManager = NetworkCookieManagerImpl(
        resourceManager = resourceManager,
        configDiskSource = configDiskSource,
        cookieDiskSource = cookieDiskSource,
        cookieAcquisitionRequestManager = cookieAcquisitionRequestManager,
    )

    @Provides
    @Singleton
    fun provideNetworkPermissionManager(
        @ApplicationContext context: Context,
        resourceManager: ResourceManager,
    ): NetworkPermissionManager = NetworkPermissionManagerImpl(
        context = context,
        resourceManager = resourceManager,
    )

    @Provides
    @Singleton
    fun provideSettingsLogManager(
        settingsRepository: SettingsRepository,
        logsManager: LogsManager,
        autofillEnabledManager: AutofillEnabledManager,
        accessibilityEnabledManager: AccessibilityEnabledManager,
        browserThirdPartyAutofillEnabledManager: BrowserThirdPartyAutofillEnabledManager,
    ): SettingsLogManager = SettingsLogManagerImpl(
        settingsRepository = settingsRepository,
        logsManager = logsManager,
        autofillEnabledManager = autofillEnabledManager,
        accessibilityEnabledManager = accessibilityEnabledManager,
        browserThirdPartyAutofillEnabledManager = browserThirdPartyAutofillEnabledManager,
    )

    @Provides
    @Singleton
    fun provideKeyRotationManager(
        authDiskSource: AuthDiskSource,
        vaultSdkSource: VaultSdkSource,
    ): KeyRotationManager = KeyRotationManagerImpl(
        authDiskSource = authDiskSource,
        vaultSdkSource = vaultSdkSource,
    )
}
