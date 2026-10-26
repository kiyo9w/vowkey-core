package com.vowkey.authenticator.data.platform.provider.di

import com.vowkey.authenticator.data.platform.provider.BaseUrlsProviderImpl
import com.vowkey.network.interceptor.BaseUrlsProvider
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Module responsible for providing platform provider dependencies.
 */
@Module
@InstallIn(SingletonComponent::class)
object PlatformProviderModule {

    @Provides
    @Singleton
    fun provideBaseUrlsProvider(): BaseUrlsProvider = BaseUrlsProviderImpl
}
