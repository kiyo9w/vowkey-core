package com.vowkey.app.data.autofill.util

import com.vowkey.vault.CardListView
import com.vowkey.vault.CipherListView
import com.vowkey.vault.CipherListViewType
import com.vowkey.vault.CopyableCipherFields
import com.vowkey.vault.LoginListView
import com.vowkey.app.data.platform.util.isActive

/**
 * Returns true when the cipher is not archived, not deleted and contains at least one FIDO 2
 * credential.
 */
val CipherListView.isActiveWithFido2Credentials: Boolean
    get() = isActive && login?.hasFido2 ?: false

/**
 * Returns true when the cipher type is not archived, not deleted and contains a copyable password.
 */
val CipherListView.isActiveWithCopyablePassword: Boolean
    get() = isActive && copyableFields.contains(CopyableCipherFields.LOGIN_PASSWORD)

/**
 * Returns the [LoginListView] if the cipher is of type [CipherListViewType.Login], otherwise null.
 */
val CipherListView.login: LoginListView?
    get() = (this.type as? CipherListViewType.Login)?.v1

/**
 * Returns the [CardListView] if the cipher is of type [CipherListViewType.Card], otherwise null.
 */
val CipherListView.card: CardListView?
    get() = (this.type as? CipherListViewType.Card)?.v1
