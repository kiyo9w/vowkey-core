package com.vowkey.app.ui.platform.manager.di

import android.content.Context
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.ui.platform.manager.share.ShareManager
import com.vowkey.ui.platform.manager.share.ShareManagerImpl
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManager
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManagerImpl
import com.vowkey.app.ui.platform.manager.VowkeyBuildInfoManagerImpl
import com.vowkey.app.ui.platform.manager.resource.ResourceManager
import com.vowkey.app.ui.platform.manager.resource.ResourceManagerImpl
import com.vowkey.app.ui.platform.model.SnackbarRelay
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides UI-based managers in the platform package.
 */
@Module
@InstallIn(SingletonComponent::class)
object PlatformUiManagerModule {

    @Provides
    @Singleton
    fun provideBuildInfoManager(): BuildInfoManager = VowkeyBuildInfoManagerImpl()

    @Provides
    @Singleton
    fun provideResourceManager(@ApplicationContext context: Context): ResourceManager =
        ResourceManagerImpl(context = context)

    @Provides
    @Singleton
    fun provideSnackbarRelayManager(
        dispatcherManager: DispatcherManager,
    ): SnackbarRelayManager<SnackbarRelay> = SnackbarRelayManagerImpl(
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideShareManager(
        @ApplicationContext context: Context,
        buildInfoManager: BuildInfoManager,
    ): ShareManager = ShareManagerImpl(
        context = context,
        buildInfoManager = buildInfoManager,
    )
}
