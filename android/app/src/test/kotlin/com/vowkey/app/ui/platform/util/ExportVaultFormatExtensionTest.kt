package com.vowkey.app.ui.platform.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.platform.feature.settings.exportvault.model.ExportVaultFormat
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class ExportVaultFormatExtensionTest {
    @Test
    fun `displayLabel should return the correct value for each type`() {
        mapOf(
            ExportVaultFormat.JSON to VowkeyString.json_extension.asText(),
            ExportVaultFormat.CSV to VowkeyString.csv_extension.asText(),
            ExportVaultFormat.JSON_ENCRYPTED to VowkeyString.json_extension_formatted.asText(
                VowkeyString.password_protected.asText(),
            ),
        )
            .forEach { (type, label) ->
                assertEquals(
                    label,
                    type.displayLabel,
                )
            }
    }

    @Test
    fun `fileExtension should return the correct value for each type`() {
        mapOf(
            ExportVaultFormat.JSON to "json",
            ExportVaultFormat.CSV to "csv",
            ExportVaultFormat.JSON_ENCRYPTED to "json",
        )
            .forEach { (type, label) ->
                assertEquals(
                    label,
                    type.fileExtension,
                )
            }
    }
}
