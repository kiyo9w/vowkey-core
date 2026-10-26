package com.vowkey.core.data.manager.di

import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.core.data.manager.UuidManager
import com.vowkey.core.data.manager.UuidManagerImpl
import com.vowkey.core.data.manager.encryption.EncryptionManager
import com.vowkey.core.data.manager.encryption.EncryptionManagerImpl
import com.vowkey.core.data.manager.encryption.KeystoreManager
import com.vowkey.core.data.manager.encryption.KeystoreManagerImpl
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * Provides managers in the core module.
 */
@Module
@InstallIn(SingletonComponent::class)
object CoreManagerModule {

    @Provides
    @Singleton
    fun provideEncryptionManager(
        keystoreManager: KeystoreManager,
    ): EncryptionManager = EncryptionManagerImpl(
        keystoreManager = keystoreManager,
    )

    @Provides
    @Singleton
    fun provideKeystoreManager(
        buildInfoManager: BuildInfoManager,
    ): KeystoreManager = KeystoreManagerImpl(
        buildInfoManager = buildInfoManager,
    )

    @Provides
    @Singleton
    fun provideUuidManager(): UuidManager = UuidManagerImpl()
}
