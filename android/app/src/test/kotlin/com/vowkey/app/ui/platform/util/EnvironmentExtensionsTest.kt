package com.vowkey.app.ui.platform.util

import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class EnvironmentExtensionsTest {
    @Test
    fun `displayLabel for US type should return the correct value`() {
        assertEquals(
            "vowkey.com".asText(),
            Environment.Type.US.displayLabel,
        )
    }

    @Test
    fun `displayLabel for EU type should return the correct value`() {
        assertEquals(
            "vowkey.eu".asText(),
            Environment.Type.EU.displayLabel,
        )
    }

    @Test
    fun `displayLabel for FED_RAMP type should return the correct value`() {
        assertEquals(
            "vowkey-gov.com".asText(),
            Environment.Type.FED_RAMP.displayLabel,
        )
    }

    @Test
    fun `displayLabel for SELF_HOSTED type should return the correct value`() {
        assertEquals(
            VowkeyString.self_hosted.asText(),
            Environment.Type.SELF_HOSTED.displayLabel,
        )
    }
}
