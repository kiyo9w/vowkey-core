package com.vowkey.app.ui.vault.feature.addedit.model

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Represents the different actions that can be taken in a custom
 * item edit menu.
 */
enum class CustomFieldAction(val actionText: Text) {
    EDIT(VowkeyString.edit.asText()),
    MOVE_UP(VowkeyString.move_up.asText()),
    MOVE_DOWN(VowkeyString.move_down.asText()),
    REMOVE(VowkeyString.remove.asText()),
}
