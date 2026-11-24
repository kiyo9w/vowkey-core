package com.vowkey.app.data.vault.datasource.disk.di

import android.app.Application
import androidx.room3.Room
import androidx.sqlite.driver.AndroidSQLiteDriver
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.app.data.platform.manager.DatabaseSchemeManager
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSource
import com.vowkey.app.data.vault.datasource.disk.VaultDiskSourceImpl
import com.vowkey.app.data.vault.datasource.disk.callback.DatabaseSchemeCallback
import com.vowkey.app.data.vault.datasource.disk.convertor.InstantTypeConverter
import com.vowkey.app.data.vault.datasource.disk.dao.CiphersDao
import com.vowkey.app.data.vault.datasource.disk.dao.CollectionsDao
import com.vowkey.app.data.vault.datasource.disk.dao.DomainsDao
import com.vowkey.app.data.vault.datasource.disk.dao.FoldersDao
import com.vowkey.app.data.vault.datasource.disk.dao.SendsDao
import com.vowkey.app.data.vault.datasource.disk.database.VaultDatabase
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import javax.inject.Singleton

/**
 * Provides database dependencies in the vault package.
 */
@Module
@InstallIn(SingletonComponent::class)
class VaultDiskModule {

    @Provides
    @Singleton
    fun provideVaultDatabase(
        app: Application,
        databaseSchemeManager: DatabaseSchemeManager,
    ): VaultDatabase =
        Room
            .databaseBuilder<VaultDatabase>(context = app, name = "vault_database")
            .fallbackToDestructiveMigration(dropAllTables = false)
            .addCallback(DatabaseSchemeCallback(databaseSchemeManager = databaseSchemeManager))
            .addColumnTypeConverter(typeConverter = InstantTypeConverter())
            .setDriver(driver = AndroidSQLiteDriver())
            .build()

    @Provides
    @Singleton
    fun provideCipherDao(database: VaultDatabase): CiphersDao = database.cipherDao()

    @Provides
    @Singleton
    fun provideCollectionDao(database: VaultDatabase): CollectionsDao = database.collectionDao()

    @Provides
    @Singleton
    fun provideDomainsDao(database: VaultDatabase): DomainsDao = database.domainsDao()

    @Provides
    @Singleton
    fun provideFolderDao(database: VaultDatabase): FoldersDao = database.folderDao()

    @Provides
    @Singleton
    fun provideSendDao(database: VaultDatabase): SendsDao = database.sendsDao()

    @Provides
    @Singleton
    fun provideVaultDiskSource(
        ciphersDao: CiphersDao,
        collectionsDao: CollectionsDao,
        domainsDao: DomainsDao,
        foldersDao: FoldersDao,
        sendsDao: SendsDao,
        json: Json,
        dispatcherManager: DispatcherManager,
    ): VaultDiskSource = VaultDiskSourceImpl(
        ciphersDao = ciphersDao,
        collectionsDao = collectionsDao,
        domainsDao = domainsDao,
        foldersDao = foldersDao,
        sendsDao = sendsDao,
        json = json,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideLocalVaultStore(
        app: Application,
        keystoreManager: com.vowkey.core.data.manager.encryption.KeystoreManager,
        sdkClientManager: com.vowkey.app.data.platform.manager.SdkClientManager,
        json: Json,
    ) = com.vowkey.app.data.vault.datasource.disk.LocalVaultStore(
        context = app,
        keystoreManager = keystoreManager,
        client = sdkClientManager.globalClient,
        json = json,
    )

    @Provides
    @Singleton
    fun provideDocumentOcrEngine(): com.vowkey.app.data.vault.datasource.disk.DocumentOcrEngine =
        com.vowkey.app.data.vault.datasource.disk.MlKitDocumentOcrEngine()

    @Provides
    @Singleton
    fun provideGuestDecision(
        json: Json,
        store: com.vowkey.app.data.vault.datasource.disk.LocalVaultStore,
        auth: com.vowkey.app.data.auth.datasource.disk.AuthDiskSource,
        environment: com.vowkey.app.data.platform.repository.EnvironmentRepository,
        ocr: com.vowkey.app.data.vault.datasource.disk.DocumentOcrEngine,
    ) = com.vowkey.app.data.vault.datasource.disk.GuestDecision(json, store, auth, environment, ocr)
}
