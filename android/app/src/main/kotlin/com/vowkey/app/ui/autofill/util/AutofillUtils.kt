package com.vowkey.app.ui.autofill.util

import androidx.core.content.ContextCompat
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.data.autofill.model.AutofillAppInfo
import com.vowkey.app.data.autofill.model.AutofillCipher

/**
 * Creates content description for an autofill suggestion given an [AutofillCipher] and
 * [AutofillAppInfo].
 */
fun getAutofillSuggestionContentDescription(
    autofillCipher: AutofillCipher,
    autofillAppInfo: AutofillAppInfo,
): String =
    String.format(
        "%s, %s, %s, %s",
        ContextCompat.getString(autofillAppInfo.context, VowkeyString.autofill_suggestion),
        getAutofillSuggestionCipherType(
            autofillCipher = autofillCipher,
            autofillAppInfo = autofillAppInfo,
        ),
        autofillCipher.name,
        autofillCipher.subtitle,
    )

private fun getAutofillSuggestionCipherType(
    autofillCipher: AutofillCipher,
    autofillAppInfo: AutofillAppInfo,
): String =
    when (autofillCipher) {
        is AutofillCipher.Card -> ContextCompat.getString(
            autofillAppInfo.context,
            VowkeyString.type_card,
        )

        is AutofillCipher.Login -> ContextCompat.getString(
            autofillAppInfo.context,
            VowkeyString.type_login,
        )

        is AutofillCipher.Identity -> ContextCompat.getString(
            autofillAppInfo.context,
            VowkeyString.type_identity,
        )
    }
