package com.vowkey.authenticatorbridge.util

import com.vowkey.authenticatorbridge.model.SymmetricEncryptionKeyData
import com.vowkey.authenticatorbridge.provider.SymmetricKeyStorageProvider

/**
 * A fake implementation of [SymmetricKeyStorageProvider] for testing purposes.
 */
class FakeSymmetricKeyStorageProvider : SymmetricKeyStorageProvider {
    override var symmetricKey: SymmetricEncryptionKeyData? = null
}
