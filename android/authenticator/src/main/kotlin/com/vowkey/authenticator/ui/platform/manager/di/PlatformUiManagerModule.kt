package com.vowkey.authenticator.ui.platform.manager.di

import com.vowkey.authenticator.ui.platform.manager.AuthenticatorBuildInfoManagerImpl
import com.vowkey.authenticator.ui.platform.model.SnackbarRelay
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManager
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManagerImpl
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides UI-based managers in the platform package.
 */
@Module
@InstallIn(SingletonComponent::class)
class PlatformUiManagerModule {
    @Provides
    @Singleton
    fun provideBuildInfoManager(): BuildInfoManager = AuthenticatorBuildInfoManagerImpl()

    @Provides
    @Singleton
    fun provideSnackbarRelayManager(
        dispatcherManager: DispatcherManager,
    ): SnackbarRelayManager<SnackbarRelay> = SnackbarRelayManagerImpl(
        dispatcherManager = dispatcherManager,
    )
}
