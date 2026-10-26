package com.vowkey.app.data.auth.datasource.sdk.di

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSource
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSourceImpl
import com.vowkey.app.data.platform.manager.SdkClientManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides SDK-related dependencies for the auth package.
 */
@Module
@InstallIn(SingletonComponent::class)
object AuthSdkModule {

    @Provides
    @Singleton
    fun provideAuthSdkSource(
        dispatcherManager: DispatcherManager,
        sdkClientManager: SdkClientManager,
    ): AuthSdkSource = AuthSdkSourceImpl(
        dispatcherManager = dispatcherManager,
        sdkClientManager = sdkClientManager,
    )
}
