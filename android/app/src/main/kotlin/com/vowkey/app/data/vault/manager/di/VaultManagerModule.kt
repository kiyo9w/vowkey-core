package com.vowkey.app.data.vault.manager.di

import android.content.Context
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.core.data.manager.realtime.RealtimeManager
import com.vowkey.cxf.parser.CredentialExchangePayloadParser
import com.vowkey.data.manager.appstate.AppStateManager
import com.vowkey.data.manager.file.FileManager
import com.vowkey.network.service.CiphersService
import com.vowkey.network.service.DownloadService
import com.vowkey.network.service.FolderService
import com.vowkey.network.service.SendsService
import com.vowkey.network.service.SyncService
import com.vowkey.ui.platform.feature.cardscanner.manager.CardScanManager
import com.vowkey.ui.platform.feature.cardscanner.manager.CardScanManagerImpl
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSource
import com.vowkey.app.data.auth.manager.KdfManager
import com.vowkey.app.data.auth.manager.TrustedDeviceManager
import com.vowkey.app.data.auth.manager.UserLogoutManager
import com.vowkey.app.data.auth.manager.UserStateManager
import com.vowkey.app.data.autofill.manager.FillAssistManager
import com.vowkey.app.data.platform.datasource.disk.SettingsDiskSource
import com.vowkey.app.data.platform.manager.DatabaseSchemeManager
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.PolicyManager
import com.vowkey.app.data.platform.manager.PushManager
import com.vowkey.app.data.platform.manager.ReviewPromptManager
import com.vowkey.app.data.platform.manager.keyrotation.KeyRotationManager
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManager
import com.vowkey.app.data.platform.manager.policy.PasswordPolicyManager
import com.vowkey.app.data.platform.repository.SettingsRepository
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.manager.CipherManager
import com.vowkey.app.data.vault.manager.CipherManagerImpl
import com.vowkey.app.data.vault.manager.CredentialExchangeImportManager
import com.vowkey.app.data.vault.manager.CredentialExchangeImportManagerImpl
import com.vowkey.app.data.vault.manager.FolderManager
import com.vowkey.app.data.vault.manager.FolderManagerImpl
import com.vowkey.app.data.vault.manager.PinProtectedUserKeyManager
import com.vowkey.app.data.vault.manager.PinProtectedUserKeyManagerImpl
import com.vowkey.app.data.vault.manager.SendManager
import com.vowkey.app.data.vault.manager.SendManagerImpl
import com.vowkey.app.data.vault.manager.TotpCodeManager
import com.vowkey.app.data.vault.manager.TotpCodeManagerImpl
import com.vowkey.app.data.vault.manager.VaultLockManager
import com.vowkey.app.data.vault.manager.VaultLockManagerImpl
import com.vowkey.app.data.vault.manager.VaultMigrationManager
import com.vowkey.app.data.vault.manager.VaultMigrationManagerImpl
import com.vowkey.app.data.vault.manager.VaultSyncManager
import com.vowkey.app.data.vault.manager.VaultSyncManagerImpl
import com.vowkey.app.data.vault.repository.VaultRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides managers in the vault package.
 */
@Module
@InstallIn(SingletonComponent::class)
object VaultManagerModule {

    @Provides
    @Singleton
    fun provideCardScanManager(): CardScanManager = CardScanManagerImpl()

    @Provides
    @Singleton
    fun provideVaultMigrationManager(
        authDiskSource: AuthDiskSource,
        vaultDiskSource: VaultDiskSource,
        vaultRepository: VaultRepository,
        vaultSdkSource: VaultSdkSource,
        ciphersService: CiphersService,
        settingsDiskSource: SettingsDiskSource,
        vaultLockManager: VaultLockManager,
        policyManager: PolicyManager,
        featureFlagManager: FeatureFlagManager,
        connectionManager: NetworkConnectionManager,
        dispatcherManager: DispatcherManager,
    ): VaultMigrationManager = VaultMigrationManagerImpl(
        authDiskSource = authDiskSource,
        vaultDiskSource = vaultDiskSource,
        vaultRepository = vaultRepository,
        vaultSdkSource = vaultSdkSource,
        ciphersService = ciphersService,
        settingsDiskSource = settingsDiskSource,
        vaultLockManager = vaultLockManager,
        policyManager = policyManager,
        featureFlagManager = featureFlagManager,
        connectionManager = connectionManager,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideCipherManager(
        downloadService: DownloadService,
        ciphersService: CiphersService,
        settingsDiskSource: SettingsDiskSource,
        vaultDiskSource: VaultDiskSource,
        vaultSdkSource: VaultSdkSource,
        authDiskSource: AuthDiskSource,
        fileManager: FileManager,
        clock: Clock,
        reviewPromptManager: ReviewPromptManager,
        dispatcherManager: DispatcherManager,
        pushManager: PushManager,
        json: kotlinx.serialization.json.Json,
        localVault: com.vowkey.app.data.vault.datasource.disk.LocalVaultStore,
    ): CipherManager = CipherManagerImpl(
        downloadService = downloadService,
        fileManager = fileManager,
        settingsDiskSource = settingsDiskSource,
        authDiskSource = authDiskSource,
        ciphersService = ciphersService,
        vaultDiskSource = vaultDiskSource,
        vaultSdkSource = vaultSdkSource,
        clock = clock,
        reviewPromptManager = reviewPromptManager,
        dispatcherManager = dispatcherManager,
        pushManager = pushManager,
        json = json,
        localVault = localVault,
    )

    @Provides
    @Singleton
    fun provideFolderManager(
        folderService: FolderService,
        settingsDiskSource: SettingsDiskSource,
        vaultDiskSource: VaultDiskSource,
        vaultSdkSource: VaultSdkSource,
        authDiskSource: AuthDiskSource,
        dispatcherManager: DispatcherManager,
        pushManager: PushManager,
    ): FolderManager = FolderManagerImpl(
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        folderService = folderService,
        vaultDiskSource = vaultDiskSource,
        vaultSdkSource = vaultSdkSource,
        dispatcherManager = dispatcherManager,
        pushManager = pushManager,
    )

    @Provides
    @Singleton
    fun provideSendManager(
        sendsService: SendsService,
        vaultDiskSource: VaultDiskSource,
        vaultSdkSource: VaultSdkSource,
        authDiskSource: AuthDiskSource,
        settingsDiskSource: SettingsDiskSource,
        fileManager: FileManager,
        reviewPromptManager: ReviewPromptManager,
        pushManager: PushManager,
        dispatcherManager: DispatcherManager,
    ): SendManager = SendManagerImpl(
        fileManager = fileManager,
        authDiskSource = authDiskSource,
        settingsDiskSource = settingsDiskSource,
        sendsService = sendsService,
        vaultDiskSource = vaultDiskSource,
        vaultSdkSource = vaultSdkSource,
        reviewPromptManager = reviewPromptManager,
        pushManager = pushManager,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideVaultLockManager(
        @ApplicationContext context: Context,
        clock: Clock,
        realtimeManager: RealtimeManager,
        authDiskSource: AuthDiskSource,
        authSdkSource: AuthSdkSource,
        vaultSdkSource: VaultSdkSource,
        settingsRepository: SettingsRepository,
        appStateManager: AppStateManager,
        userLogoutManager: UserLogoutManager,
        dispatcherManager: DispatcherManager,
        trustedDeviceManager: TrustedDeviceManager,
        kdfManager: KdfManager,
        pinProtectedUserKeyManager: PinProtectedUserKeyManager,
        passwordPolicyManager: PasswordPolicyManager,
        keyRotationManager: KeyRotationManager,
        guestMigration: com.vowkey.app.data.vault.datasource.disk.GuestVaultMigration,
    ): VaultLockManager =
        VaultLockManagerImpl(
            context = context,
            clock = clock,
            realtimeManager = realtimeManager,
            authDiskSource = authDiskSource,
            authSdkSource = authSdkSource,
            vaultSdkSource = vaultSdkSource,
            settingsRepository = settingsRepository,
            appStateManager = appStateManager,
            userLogoutManager = userLogoutManager,
            dispatcherManager = dispatcherManager,
            trustedDeviceManager = trustedDeviceManager,
            kdfManager = kdfManager,
            pinProtectedUserKeyManager = pinProtectedUserKeyManager,
            passwordPolicyManager = passwordPolicyManager,
            keyRotationManager = keyRotationManager,
            guestMigration = guestMigration,
        )

    @Provides
    @Singleton
    fun provideGuestVaultMigration(
        store: com.vowkey.app.data.vault.datasource.disk.LocalVaultStore,
        ciphers: com.vowkey.network.service.CiphersService,
        vaultSdk: com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource,
        vaultDisk: com.vowkey.app.data.vault.datasource.disk.VaultDiskSource,
        clients: com.vowkey.app.data.platform.manager.SdkClientManager,
        json: kotlinx.serialization.json.Json,
        downloads: com.vowkey.network.service.DownloadService,
        accounts: com.vowkey.network.service.AccountsService,
    ) = com.vowkey.app.data.vault.datasource.disk.GuestVaultMigration(
        store = store,
        ciphers = ciphers,
        vaultSdk = vaultSdk,
        vaultDisk = vaultDisk,
        client = clients.globalClient,
        json = json,
        downloads = downloads,
        accounts = accounts,
    )

    @Provides
    @Singleton
    fun providePinProtectedUserKeyManager(
        authDiskSource: AuthDiskSource,
        vaultSdkSource: VaultSdkSource,
    ): PinProtectedUserKeyManager =
        PinProtectedUserKeyManagerImpl(
            authDiskSource = authDiskSource,
            vaultSdkSource = vaultSdkSource,
        )

    @Provides
    @Singleton
    fun provideTotpManager(
        vaultSdkSource: VaultSdkSource,
        dispatcherManager: DispatcherManager,
        clock: Clock,
    ): TotpCodeManager =
        TotpCodeManagerImpl(
            vaultSdkSource = vaultSdkSource,
            dispatcherManager = dispatcherManager,
            clock = clock,
        )

    @Provides
    @Singleton
    fun provideVaultSyncManager(
        fillAssistManager: FillAssistManager,
        syncService: SyncService,
        settingsDiskSource: SettingsDiskSource,
        authDiskSource: AuthDiskSource,
        vaultDiskSource: VaultDiskSource,
        vaultSdkSource: VaultSdkSource,
        userLogoutManager: UserLogoutManager,
        userStateManager: UserStateManager,
        vaultLockManager: VaultLockManager,
        clock: Clock,
        databaseSchemeManager: DatabaseSchemeManager,
        pushManager: PushManager,
        dispatcherManager: DispatcherManager,
    ): VaultSyncManager = VaultSyncManagerImpl(
        fillAssistManager = fillAssistManager,
        syncService = syncService,
        settingsDiskSource = settingsDiskSource,
        authDiskSource = authDiskSource,
        vaultDiskSource = vaultDiskSource,
        vaultSdkSource = vaultSdkSource,
        userLogoutManager = userLogoutManager,
        userStateManager = userStateManager,
        vaultLockManager = vaultLockManager,
        clock = clock,
        databaseSchemeManager = databaseSchemeManager,
        pushManager = pushManager,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideCredentialExchangeImportManager(
        vaultSdkSource: VaultSdkSource,
        ciphersService: CiphersService,
        vaultSyncManager: VaultSyncManager,
        policyManager: PolicyManager,
        credentialExchangePayloadParser: CredentialExchangePayloadParser,
    ): CredentialExchangeImportManager = CredentialExchangeImportManagerImpl(
        vaultSdkSource = vaultSdkSource,
        ciphersService = ciphersService,
        vaultSyncManager = vaultSyncManager,
        policyManager = policyManager,
        credentialExchangePayloadParser = credentialExchangePayloadParser,
    )
}
