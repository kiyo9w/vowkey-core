package com.vowkey.app.data.auth.manager

import com.vowkey.ui.platform.model.TotpData

/**
 * Default in memory implementation for [AddTotpItemFromAuthenticatorManager].
 */
class AddTotpItemFromAuthenticatorManagerImpl : AddTotpItemFromAuthenticatorManager {

    override var pendingAddTotpLoginItemData: TotpData? = null
}
