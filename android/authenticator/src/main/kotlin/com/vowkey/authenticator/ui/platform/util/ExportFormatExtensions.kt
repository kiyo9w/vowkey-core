package com.vowkey.authenticator.ui.platform.util

import com.vowkey.authenticator.ui.platform.feature.settings.export.model.ExportVaultFormat
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 *  Provides a human-readable label for the export format.
 */
val ExportVaultFormat.displayLabel: Text
    get() = when (this) {
        ExportVaultFormat.JSON -> VowkeyString.json_extension.asText()
        ExportVaultFormat.CSV -> VowkeyString.csv_extension.asText()
    }

/**
 * Provides the file extension associated with the export format.
 */
val ExportVaultFormat.fileExtension: String
    get() = when (this) {
        ExportVaultFormat.JSON -> "json"
        ExportVaultFormat.CSV -> "csv"
    }
