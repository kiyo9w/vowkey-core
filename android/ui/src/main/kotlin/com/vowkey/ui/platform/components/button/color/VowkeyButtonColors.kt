package com.vowkey.ui.platform.components.button.color

import androidx.compose.material3.ButtonColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.components.button.model.VowkeyOutlinedButtonColors
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for a filled button.
 */
@Composable
fun vowkeyFilledButtonColors(): ButtonColors = ButtonColors(
    containerColor = VowkeyTheme.colorScheme.filledButton.background,
    contentColor = VowkeyTheme.colorScheme.filledButton.foreground,
    disabledContainerColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledContentColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)

/**
 * Provides a default set of Vowkey-styled colors for a filled error button.
 */
@Composable
fun vowkeyFilledErrorButtonColors() = ButtonColors(
    containerColor = VowkeyTheme.colorScheme.status.weak1,
    contentColor = VowkeyTheme.colorScheme.filledButton.foreground,
    disabledContainerColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledContentColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
)

/**
 * Provides a default set of Vowkey-styled colors for an outlined button.
 */
@Composable
fun vowkeyOutlinedButtonColors(
    contentColor: Color = VowkeyTheme.colorScheme.outlineButton.foreground,
    outlineColor: Color = VowkeyTheme.colorScheme.outlineButton.border,
    outlineColorDisabled: Color = VowkeyTheme.colorScheme.outlineButton.borderDisabled,
): VowkeyOutlinedButtonColors =
    VowkeyOutlinedButtonColors(
        materialButtonColors = ButtonColors(
            containerColor = Color.Transparent,
            contentColor = contentColor,
            disabledContainerColor = Color.Transparent,
            disabledContentColor = VowkeyTheme.colorScheme.outlineButton.foregroundDisabled,
        ),
        outlineBorderColor = outlineColor,
        outlinedDisabledBorderColor = outlineColorDisabled,
    )

/**
 * Provides a default set of Vowkey-styled colors for a text button.
 */
@Composable
fun vowkeyTextButtonColors(
    contentColor: Color = VowkeyTheme.colorScheme.outlineButton.foreground,
): ButtonColors = ButtonColors(
    containerColor = Color.Transparent,
    contentColor = contentColor,
    disabledContainerColor = Color.Transparent,
    disabledContentColor = VowkeyTheme.colorScheme.outlineButton.foregroundDisabled,
)
