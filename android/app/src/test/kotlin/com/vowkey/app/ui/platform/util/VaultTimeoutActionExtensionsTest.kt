package com.vowkey.app.ui.platform.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.repository.model.VaultTimeoutAction
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class VaultTimeoutActionExtensionsTest {
    @Test
    fun `displayLabel should return the correct value for each type`() {
        mapOf(
            VaultTimeoutAction.LOCK to VowkeyString.lock.asText(),
            VaultTimeoutAction.LOGOUT to VowkeyString.log_out.asText(),
        )
            .forEach { (type, label) ->
                assertEquals(
                    label,
                    type.displayLabel,
                )
            }
    }
}
