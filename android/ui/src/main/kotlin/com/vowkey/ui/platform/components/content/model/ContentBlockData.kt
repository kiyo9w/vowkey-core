package com.vowkey.ui.platform.components.content.model

import androidx.annotation.DrawableRes
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.AnnotatedString
import com.vowkey.ui.platform.base.util.toAnnotatedString
import com.vowkey.ui.platform.components.content.VowkeyContentBlock

/**
 * Wrapper class for data to display in a [VowkeyContentBlock]
 */
@Immutable
data class ContentBlockData(
    val headerText: AnnotatedString,
    val subtitleText: AnnotatedString? = null,
    @field:DrawableRes val iconVectorResource: Int? = null,
) {
    /**
     * Overloaded constructor for [ContentBlockData] that takes a [String] for the
     * header text.
     */
    constructor(
        headerText: String,
        subtitleText: String? = null,
        @DrawableRes iconVectorResource: Int? = null,
    ) : this(
        headerText = headerText.toAnnotatedString(),
        subtitleText = subtitleText?.toAnnotatedString(),
        iconVectorResource = iconVectorResource,
    )
}
