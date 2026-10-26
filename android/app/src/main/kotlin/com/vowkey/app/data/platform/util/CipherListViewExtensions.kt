package com.vowkey.app.data.platform.util

import com.vowkey.vault.CipherListView

/**
 * Indicates if this [CipherListView] is active based on its deleted or archived status.
 */
val CipherListView.isActive: Boolean
    get() = this.archivedDate == null && this.deletedDate == null
