package com.vowkey.app.data.credentials.datasource.network.di

import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.service.DigitalAssetLinkService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides network dependencies in the fido2 package.
 */
@Module
@InstallIn(SingletonComponent::class)
object CredentialProviderNetworkModule {

    @Provides
    @Singleton
    fun provideDigitalAssetLinkService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): DigitalAssetLinkService =
        vowkeyServiceClient.digitalAssetLinkService
}
