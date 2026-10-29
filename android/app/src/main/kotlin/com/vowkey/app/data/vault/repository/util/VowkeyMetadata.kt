package com.vowkey.app.data.vault.repository.util

import com.vowkey.vault.FieldView

/** Reserved encrypted metadata is preserved verbatim, outside ordinary custom-field surfaces. */
val FieldView.isVowkeyMetadata: Boolean get() = name == "vk.meta"

fun List<FieldView>.withoutVowkeyMetadata(): List<FieldView> = filterNot { it.isVowkeyMetadata }
