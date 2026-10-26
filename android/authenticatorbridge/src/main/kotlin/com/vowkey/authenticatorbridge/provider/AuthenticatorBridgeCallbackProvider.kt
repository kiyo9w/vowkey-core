package com.vowkey.authenticatorbridge.provider

import com.vowkey.authenticatorbridge.IAuthenticatorBridgeServiceCallback
import com.vowkey.authenticatorbridge.model.EncryptedSharedAccountData

/**
 * Provides an implementation of [IAuthenticatorBridgeServiceCallback]. This is useful
 * for writing unit tests that don't touch Binder logic.
 */
interface AuthenticatorBridgeCallbackProvider {

    /**
     * Get a [IAuthenticatorBridgeServiceCallback] that will call delegate [onAccountsSync] call
     * to the given lambda.
     *
     * @param onAccountsSync Lambda that will be invoked when [onAccountsSync] calls back.
     */
    fun getCallback(
        onAccountsSync: (EncryptedSharedAccountData) -> Unit,
    ): IAuthenticatorBridgeServiceCallback
}
