package com.vowkey.authenticator.data.authenticator.repository.util

import com.vowkey.authenticator.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.authenticatorbridge.model.SymmetricEncryptionKeyData
import com.vowkey.authenticatorbridge.provider.SymmetricKeyStorageProvider
import com.vowkey.authenticatorbridge.util.toSymmetricEncryptionKeyData

/**
 * Implementation of [SymmetricKeyStorageProvider] that stores symmetric key data in encrypted
 * shared preferences.
 */
class SymmetricKeyStorageProviderImpl(
    private val authDiskSource: AuthDiskSource,
) : SymmetricKeyStorageProvider {

    override var symmetricKey: SymmetricEncryptionKeyData?
        get() = authDiskSource.authenticatorBridgeSymmetricSyncKey?.toSymmetricEncryptionKeyData()
        set(value) {
            authDiskSource.authenticatorBridgeSymmetricSyncKey =
                value?.symmetricEncryptionKey?.byteArray
        }
}
