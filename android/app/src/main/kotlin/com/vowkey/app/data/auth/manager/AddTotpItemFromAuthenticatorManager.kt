package com.vowkey.app.data.auth.manager

import com.vowkey.ui.platform.model.TotpData

/**
 * Manager for keeping track of requests from the Vowkey Authenticator app to add a TOTP
 * item.
 */
interface AddTotpItemFromAuthenticatorManager {

    /**
     * Current pending [TotpData] to be added from the Authenticator app.
     */
    var pendingAddTotpLoginItemData: TotpData?
}
