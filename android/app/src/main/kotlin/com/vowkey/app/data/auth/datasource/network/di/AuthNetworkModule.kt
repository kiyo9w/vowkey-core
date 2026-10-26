package com.vowkey.app.data.auth.datasource.network.di

import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.service.AccountsService
import com.vowkey.network.service.AuthRequestsService
import com.vowkey.network.service.DevicesService
import com.vowkey.network.service.HaveIBeenPwnedService
import com.vowkey.network.service.IdentityService
import com.vowkey.network.service.NewAuthRequestService
import com.vowkey.network.service.OrganizationService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides network dependencies in the auth package.
 */
@Module
@InstallIn(SingletonComponent::class)
object AuthNetworkModule {

    @Provides
    @Singleton
    fun providesAccountService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): AccountsService = vowkeyServiceClient.accountsService

    @Provides
    @Singleton
    fun providesAuthRequestsService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): AuthRequestsService = vowkeyServiceClient.authRequestsService

    @Provides
    @Singleton
    fun providesDevicesService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): DevicesService = vowkeyServiceClient.devicesService

    @Provides
    @Singleton
    fun providesIdentityService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): IdentityService = vowkeyServiceClient.identityService

    @Provides
    @Singleton
    fun providesHaveIBeenPwnedService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): HaveIBeenPwnedService = vowkeyServiceClient.haveIBeenPwnedService

    @Provides
    @Singleton
    fun providesNewAuthRequestService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): NewAuthRequestService = vowkeyServiceClient.newAuthRequestService

    @Provides
    @Singleton
    fun providesOrganizationService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): OrganizationService = vowkeyServiceClient.organizationService
}
