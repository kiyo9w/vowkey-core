package com.vowkey.app.data.vault.datasource.network.di

import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.service.CiphersService
import com.vowkey.network.service.DownloadService
import com.vowkey.network.service.FolderService
import com.vowkey.network.service.SendsService
import com.vowkey.network.service.SyncService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides network dependencies in the vault package.
 */
@Module
@InstallIn(SingletonComponent::class)
object VaultNetworkModule {

    @Provides
    @Singleton
    fun provideCiphersService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): CiphersService = vowkeyServiceClient.ciphersService

    @Provides
    @Singleton
    fun providesFolderService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): FolderService = vowkeyServiceClient.folderService

    @Provides
    @Singleton
    fun provideSendsService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): SendsService = vowkeyServiceClient.sendsService

    @Provides
    @Singleton
    fun provideSyncService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): SyncService = vowkeyServiceClient.syncService

    @Provides
    @Singleton
    fun provideDownloadService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): DownloadService = vowkeyServiceClient.downloadService
}
