package com.vowkey.app.data.billing.datasource.network.di

import com.vowkey.network.VowkeyServiceClient
import com.vowkey.network.service.BillingService
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides network dependencies in the billing package.
 */
@Module
@InstallIn(SingletonComponent::class)
object BillingNetworkModule {

    @Provides
    @Singleton
    fun provideBillingService(
        vowkeyServiceClient: VowkeyServiceClient,
    ): BillingService = vowkeyServiceClient.billingService
}
