package com.vowkey.authenticatorbridge.util

import com.vowkey.authenticatorbridge.IAuthenticatorBridgeServiceCallback
import com.vowkey.authenticatorbridge.model.EncryptedSharedAccountData
import com.vowkey.authenticatorbridge.provider.AuthenticatorBridgeCallbackProvider

/**
 * Test implementation of [AuthenticatorBridgeCallbackProvider] that provides a testable
 * [IAuthenticatorBridgeServiceCallback.Default] implementation.
 */
class TestAuthenticatorBridgeCallbackProvider : AuthenticatorBridgeCallbackProvider {

    override fun getCallback(
        onAccountsSync: (EncryptedSharedAccountData) -> Unit,
    ): IAuthenticatorBridgeServiceCallback =
        object : IAuthenticatorBridgeServiceCallback.Default() {
            override fun onAccountsSync(data: EncryptedSharedAccountData) =
                onAccountsSync.invoke(data)
        }
}
