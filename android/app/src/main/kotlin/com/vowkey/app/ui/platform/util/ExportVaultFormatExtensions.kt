package com.vowkey.app.ui.platform.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.platform.feature.settings.exportvault.model.ExportVaultFormat

/**
 *  Provides a human-readable label for the export format.
 */
val ExportVaultFormat.displayLabel: Text
    get() = when (this) {
        ExportVaultFormat.JSON -> VowkeyString.json_extension.asText()
        ExportVaultFormat.CSV -> VowkeyString.csv_extension.asText()
        ExportVaultFormat.JSON_ENCRYPTED -> VowkeyString.json_extension_formatted.asText(
            VowkeyString.password_protected.asText(),
        )
    }

/**
 * Provides the file extension associated with the export format.
 */
val ExportVaultFormat.fileExtension: String
    get() = when (this) {
        ExportVaultFormat.JSON -> "json"
        ExportVaultFormat.CSV -> "csv"
        ExportVaultFormat.JSON_ENCRYPTED -> "json"
    }
