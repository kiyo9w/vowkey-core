package com.vowkey.app.data.tools.generator.datasource.sdk.di

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.app.data.platform.manager.SdkClientManager
import com.vowkey.app.data.tools.generator.datasource.sdk.GeneratorSdkSource
import com.vowkey.app.data.tools.generator.datasource.sdk.GeneratorSdkSourceImpl
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides SDK-related dependencies for the password generation package.
 */
@Module
@InstallIn(SingletonComponent::class)
object GeneratorSdkModule {

    @Provides
    @Singleton
    fun provideGeneratorSdkSource(
        dispatcherManager: DispatcherManager,
        sdkClientManager: SdkClientManager,
    ): GeneratorSdkSource = GeneratorSdkSourceImpl(
        dispatcherManager = dispatcherManager,
        sdkClientManager = sdkClientManager,
    )
}
