package com.vowkey.app.data.tools.generator.repository.di

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.platform.manager.ReviewPromptManager
import com.vowkey.app.data.tools.generator.datasource.disk.GeneratorDiskSource
import com.vowkey.app.data.tools.generator.datasource.disk.PasswordHistoryDiskSource
import com.vowkey.app.data.tools.generator.datasource.sdk.GeneratorSdkSource
import com.vowkey.app.data.tools.generator.repository.GeneratorRepository
import com.vowkey.app.data.tools.generator.repository.GeneratorRepositoryImpl
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides repositories in the generator package.
 */
@Module
@InstallIn(SingletonComponent::class)
object GeneratorRepositoryModule {

    @Provides
    @Singleton
    fun provideGeneratorRepository(
        clock: Clock,
        generatorSdkSource: GeneratorSdkSource,
        generatorDiskSource: GeneratorDiskSource,
        authDiskSource: AuthDiskSource,
        vaultSdkSource: VaultSdkSource,
        passwordHistoryDiskSource: PasswordHistoryDiskSource,
        dispatcherManager: DispatcherManager,
        reviewPromptManager: ReviewPromptManager,
    ): GeneratorRepository = GeneratorRepositoryImpl(
        clock = clock,
        generatorSdkSource = generatorSdkSource,
        generatorDiskSource = generatorDiskSource,
        authDiskSource = authDiskSource,
        vaultSdkSource = vaultSdkSource,
        passwordHistoryDiskSource = passwordHistoryDiskSource,
        dispatcherManager = dispatcherManager,
        reviewPromptManager = reviewPromptManager,
    )
}
