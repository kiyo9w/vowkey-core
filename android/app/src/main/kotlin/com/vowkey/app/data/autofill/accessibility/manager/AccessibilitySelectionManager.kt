package com.vowkey.app.data.autofill.accessibility.manager

import com.vowkey.vault.CipherView
import kotlinx.coroutines.flow.Flow

/**
 * A manager class used to handle the accessibility autofill selections.
 */
interface AccessibilitySelectionManager {
    /**
     * Emits a [CipherView] as a result of calls to [emitAccessibilitySelection].
     */
    val accessibilitySelectionFlow: Flow<CipherView>

    /**
     * Triggers an emission via [accessibilitySelectionFlow].
     */
    fun emitAccessibilitySelection(cipherView: CipherView)
}
