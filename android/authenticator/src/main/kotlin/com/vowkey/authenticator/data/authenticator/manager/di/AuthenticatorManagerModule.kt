package com.vowkey.authenticator.data.authenticator.manager.di

import com.vowkey.authenticator.data.authenticator.datasource.sdk.AuthenticatorSdkSource
import com.vowkey.authenticator.data.authenticator.manager.TotpCodeManager
import com.vowkey.authenticator.data.authenticator.manager.TotpCodeManagerImpl
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides managers in the authenticator package.
 */
@Module
@InstallIn(SingletonComponent::class)
object AuthenticatorManagerModule {

    @Provides
    @Singleton
    fun provideTotpCodeManager(
        authenticatorSdkSource: AuthenticatorSdkSource,
        clock: Clock,
        dispatcherManager: DispatcherManager,
    ): TotpCodeManager = TotpCodeManagerImpl(
        authenticatorSdkSource = authenticatorSdkSource,
        clock = clock,
        dispatcherManager = dispatcherManager,
    )
}
