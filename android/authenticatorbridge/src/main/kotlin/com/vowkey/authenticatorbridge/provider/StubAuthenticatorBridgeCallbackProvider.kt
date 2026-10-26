package com.vowkey.authenticatorbridge.provider

import com.vowkey.authenticatorbridge.IAuthenticatorBridgeServiceCallback
import com.vowkey.authenticatorbridge.model.EncryptedSharedAccountData

/**
 * Default implementation of [AuthenticatorBridgeCallbackProvider] that provides a live
 * [IAuthenticatorBridgeServiceCallback.Stub] implementation.
 */
class StubAuthenticatorBridgeCallbackProvider : AuthenticatorBridgeCallbackProvider {

    override fun getCallback(
        onAccountsSync: (EncryptedSharedAccountData) -> Unit,
    ): IAuthenticatorBridgeServiceCallback = object : IAuthenticatorBridgeServiceCallback.Stub() {

        override fun onAccountsSync(data: EncryptedSharedAccountData) = onAccountsSync.invoke(data)
    }
}
