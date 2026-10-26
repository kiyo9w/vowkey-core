package com.vowkey.app.ui.tools.feature.send.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.tools.feature.send.model.SendItemType

/**
 * Returns the selection text based on the given [SendItemType].
 */
val SendItemType.selectionText: Text
    get() = when (this) {
        SendItemType.FILE -> VowkeyString.file.asText()
        SendItemType.TEXT -> VowkeyString.text.asText()
    }
