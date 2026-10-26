package com.vowkey.app.data.credentials.di

import android.content.Context
import android.os.Build
import androidx.annotation.RequiresApi
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.network.service.DigitalAssetLinkService
import com.vowkey.sdk.Fido2CredentialStore
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.credentials.builder.CredentialEntryBuilder
import com.vowkey.app.data.credentials.builder.CredentialEntryBuilderImpl
import com.vowkey.app.data.credentials.datasource.disk.PrivilegedAppDiskSource
import com.vowkey.app.data.credentials.manager.VowkeyCredentialManager
import com.vowkey.app.data.credentials.manager.VowkeyCredentialManagerImpl
import com.vowkey.app.data.credentials.manager.CredentialManagerPendingIntentManager
import com.vowkey.app.data.credentials.manager.CredentialManagerPendingIntentManagerImpl
import com.vowkey.app.data.credentials.manager.CredentialProviderRequestManager
import com.vowkey.app.data.credentials.manager.CredentialProviderRequestManagerImpl
import com.vowkey.app.data.credentials.manager.OriginManager
import com.vowkey.app.data.credentials.manager.OriginManagerImpl
import com.vowkey.app.data.credentials.parser.RelyingPartyParser
import com.vowkey.app.data.credentials.parser.RelyingPartyParserImpl
import com.vowkey.app.data.credentials.processor.CredentialProviderProcessor
import com.vowkey.app.data.credentials.processor.CredentialProviderProcessorImpl
import com.vowkey.app.data.credentials.repository.PrivilegedAppRepository
import com.vowkey.app.data.credentials.repository.PrivilegedAppRepositoryImpl
import com.vowkey.app.data.credentials.sanitizer.PasskeyAttestationOptionsSanitizer
import com.vowkey.app.data.credentials.sanitizer.PasskeyAttestationOptionsSanitizerImpl
import com.vowkey.app.data.platform.manager.AssetManager
import com.vowkey.app.data.platform.manager.ciphermatching.CipherMatchingManager
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.repository.VaultRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides dependencies within the fido2 package.
 */
@Module
@InstallIn(SingletonComponent::class)
object CredentialProviderModule {

    @RequiresApi(Build.VERSION_CODES.S)
    @Provides
    @Singleton
    fun provideCredentialProviderProcessor(
        @ApplicationContext context: Context,
        authRepository: AuthRepository,
        vowkeyCredentialManager: VowkeyCredentialManager,
        dispatcherManager: DispatcherManager,
        pendingIntentManager: CredentialManagerPendingIntentManager,
        clock: Clock,
    ): CredentialProviderProcessor =
        CredentialProviderProcessorImpl(
            context = context,
            authRepository = authRepository,
            vowkeyCredentialManager = vowkeyCredentialManager,
            pendingIntentManager = pendingIntentManager,
            clock = clock,
            dispatcherManager = dispatcherManager,
        )

    @Provides
    @Singleton
    fun provideVowkeyCredentialManager(
        vaultSdkSource: VaultSdkSource,
        fido2CredentialStore: Fido2CredentialStore,
        json: Json,
        vaultRepository: VaultRepository,
        dispatcherManager: DispatcherManager,
        credentialEntryBuilder: CredentialEntryBuilder,
        cipherMatchingManager: CipherMatchingManager,
        passkeyAttestationOptionsSanitizer: PasskeyAttestationOptionsSanitizer,
    ): VowkeyCredentialManager =
        VowkeyCredentialManagerImpl(
            vaultSdkSource = vaultSdkSource,
            fido2CredentialStore = fido2CredentialStore,
            credentialEntryBuilder = credentialEntryBuilder,
            json = json,
            vaultRepository = vaultRepository,
            cipherMatchingManager = cipherMatchingManager,
            passkeyAttestationOptionsSanitizer = passkeyAttestationOptionsSanitizer,
            dispatcherManager = dispatcherManager,
        )

    @Provides
    @Singleton
    fun provideOriginManager(
        assetManager: AssetManager,
        digitalAssetLinkService: DigitalAssetLinkService,
        privilegedAppRepository: PrivilegedAppRepository,
    ): OriginManager =
        OriginManagerImpl(
            assetManager = assetManager,
            digitalAssetLinkService = digitalAssetLinkService,
            privilegedAppRepository = privilegedAppRepository,
        )

    @Provides
    @Singleton
    fun provideCredentialEntryBuilder(
        @ApplicationContext context: Context,
        pendingIntentManager: CredentialManagerPendingIntentManager,
        authRepository: AuthRepository,
    ): CredentialEntryBuilder = CredentialEntryBuilderImpl(
        context = context,
        pendingIntentManager = pendingIntentManager,
        authRepository = authRepository,
    )

    @Provides
    @Singleton
    fun providePrivilegedAppRepository(
        privilegedAppDiskSource: PrivilegedAppDiskSource,
        assetManager: AssetManager,
        dispatcherManager: DispatcherManager,
        json: Json,
    ): PrivilegedAppRepository = PrivilegedAppRepositoryImpl(
        privilegedAppDiskSource = privilegedAppDiskSource,
        assetManager = assetManager,
        dispatcherManager = dispatcherManager,
        json = json,
    )

    @Provides
    @Singleton
    fun provideRelyingPartyParser(
        json: Json,
    ): RelyingPartyParser = RelyingPartyParserImpl(json)

    @Provides
    @Singleton
    fun provideCredentialManagerPendingIntentManager(
        @ApplicationContext context: Context,
    ): CredentialManagerPendingIntentManager =
        CredentialManagerPendingIntentManagerImpl(
            context = context,
        )

    @Provides
    @Singleton
    fun providePasskeyAttestationOptionsSanitizer(): PasskeyAttestationOptionsSanitizer =
        PasskeyAttestationOptionsSanitizerImpl

    @Provides
    @Singleton
    fun provideCredentialProviderRequestManager(): CredentialProviderRequestManager =
        CredentialProviderRequestManagerImpl()
}
