package com.vowkey.authenticatorbridge;

import com.vowkey.authenticatorbridge.model.EncryptedSharedAccountData;

interface IAuthenticatorBridgeServiceCallback {

    // This function will be called when there is updated shared account data.
    void onAccountsSync(in EncryptedSharedAccountData data);

}
