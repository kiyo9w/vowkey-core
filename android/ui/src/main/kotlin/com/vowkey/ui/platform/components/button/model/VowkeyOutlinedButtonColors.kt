package com.vowkey.ui.platform.components.button.model

import androidx.compose.material3.ButtonColors
import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton

/**
 * Colors for a [VowkeyOutlinedButton].
 */
@Immutable
data class VowkeyOutlinedButtonColors(
    val materialButtonColors: ButtonColors,
    val outlineBorderColor: Color,
    val outlinedDisabledBorderColor: Color,
)
