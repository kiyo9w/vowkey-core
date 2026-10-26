package com.vowkey.data.repository.di

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.data.datasource.disk.ConfigDiskSource
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.ServerConfigRepositoryImpl
import com.vowkey.network.service.ConfigService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides repositories in the data module.
 */
@Module
@InstallIn(SingletonComponent::class)
object RepositoryModule {

    @Provides
    @Singleton
    fun provideServerConfigRepository(
        configDiskSource: ConfigDiskSource,
        configService: ConfigService,
        clock: Clock,
        dispatcherManager: DispatcherManager,
    ): ServerConfigRepository =
        ServerConfigRepositoryImpl(
            configDiskSource = configDiskSource,
            configService = configService,
            clock = clock,
            dispatcherManager = dispatcherManager,
        )
}
