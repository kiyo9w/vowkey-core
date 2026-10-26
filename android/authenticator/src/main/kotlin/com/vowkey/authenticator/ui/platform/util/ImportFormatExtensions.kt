package com.vowkey.authenticator.ui.platform.util

import com.vowkey.authenticator.data.platform.manager.imports.model.ImportFileFormat
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 *  Provides a human-readable label for the export format.
 */
val ImportFileFormat.displayLabel: Text
    get() = when (this) {
        ImportFileFormat.VOWKEY_JSON -> {
            VowkeyString.import_format_label_vowkey_json.asText()
        }

        ImportFileFormat.TWO_FAS_JSON -> {
            VowkeyString.import_format_label_2fas_json.asText()
        }

        ImportFileFormat.LAST_PASS_JSON -> {
            VowkeyString.import_format_label_lastpass_json.asText()
        }

        ImportFileFormat.AEGIS -> {
            VowkeyString.import_format_label_aegis_json.asText()
        }
    }
