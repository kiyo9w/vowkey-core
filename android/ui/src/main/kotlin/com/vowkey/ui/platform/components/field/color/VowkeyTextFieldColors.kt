package com.vowkey.ui.platform.components.field.color

import androidx.compose.foundation.text.selection.TextSelectionColors
import androidx.compose.material3.TextFieldColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for a read-only text field button.
 */
@Composable
fun vowkeyTextFieldButtonColors(): TextFieldColors = vowkeyTextFieldColors(
    disabledTextColor = VowkeyTheme.colorScheme.text.primary,
    disabledLeadingIconColor = VowkeyTheme.colorScheme.icon.primary,
    disabledTrailingIconColor = VowkeyTheme.colorScheme.icon.primary,
    disabledLabelColor = VowkeyTheme.colorScheme.text.secondary,
    disabledPlaceholderColor = VowkeyTheme.colorScheme.text.secondary,
    disabledSupportingTextColor = VowkeyTheme.colorScheme.text.secondary,
)

/**
 * Provides a default set of Vowkey-styled colors for text fields.
 */
@Composable
fun vowkeyTextFieldColors(
    textColor: Color = VowkeyTheme.colorScheme.text.primary,
    disabledTextColor: Color = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledLeadingIconColor: Color = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledTrailingIconColor: Color = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledLabelColor: Color = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledPlaceholderColor: Color = VowkeyTheme.colorScheme.text.secondary,
    disabledSupportingTextColor: Color = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    focusedIndicatorColor: Color = Color.Transparent,
    unfocusedIndicatorColor: Color = Color.Transparent,
    disabledIndicatorColor: Color = Color.Transparent,
): TextFieldColors = TextFieldColors(
    focusedTextColor = textColor,
    unfocusedTextColor = textColor,
    disabledTextColor = disabledTextColor,
    errorTextColor = VowkeyTheme.colorScheme.text.primary,
    focusedContainerColor = Color.Transparent,
    unfocusedContainerColor = Color.Transparent,
    disabledContainerColor = Color.Transparent,
    errorContainerColor = Color.Transparent,
    cursorColor = VowkeyTheme.colorScheme.text.interaction,
    errorCursorColor = VowkeyTheme.colorScheme.text.interaction,
    textSelectionColors = TextSelectionColors(
        handleColor = VowkeyTheme.colorScheme.stroke.border,
        backgroundColor = VowkeyTheme.colorScheme.stroke.border.copy(alpha = 0.4f),
    ),
    focusedIndicatorColor = focusedIndicatorColor,
    unfocusedIndicatorColor = unfocusedIndicatorColor,
    disabledIndicatorColor = disabledIndicatorColor,
    errorIndicatorColor = VowkeyTheme.colorScheme.status.error,
    focusedLeadingIconColor = VowkeyTheme.colorScheme.icon.primary,
    unfocusedLeadingIconColor = VowkeyTheme.colorScheme.icon.primary,
    disabledLeadingIconColor = disabledLeadingIconColor,
    errorLeadingIconColor = VowkeyTheme.colorScheme.icon.primary,
    focusedTrailingIconColor = VowkeyTheme.colorScheme.icon.primary,
    unfocusedTrailingIconColor = VowkeyTheme.colorScheme.icon.primary,
    disabledTrailingIconColor = disabledTrailingIconColor,
    errorTrailingIconColor = VowkeyTheme.colorScheme.status.error,
    focusedLabelColor = VowkeyTheme.colorScheme.text.secondary,
    unfocusedLabelColor = VowkeyTheme.colorScheme.text.secondary,
    disabledLabelColor = disabledLabelColor,
    errorLabelColor = VowkeyTheme.colorScheme.status.error,
    focusedPlaceholderColor = VowkeyTheme.colorScheme.text.secondary,
    unfocusedPlaceholderColor = VowkeyTheme.colorScheme.text.secondary,
    disabledPlaceholderColor = disabledPlaceholderColor,
    errorPlaceholderColor = VowkeyTheme.colorScheme.text.secondary,
    focusedSupportingTextColor = VowkeyTheme.colorScheme.text.secondary,
    unfocusedSupportingTextColor = VowkeyTheme.colorScheme.text.secondary,
    disabledSupportingTextColor = disabledSupportingTextColor,
    errorSupportingTextColor = VowkeyTheme.colorScheme.text.secondary,
    focusedPrefixColor = VowkeyTheme.colorScheme.text.secondary,
    unfocusedPrefixColor = VowkeyTheme.colorScheme.text.secondary,
    disabledPrefixColor = VowkeyTheme.colorScheme.outlineButton.foregroundDisabled,
    errorPrefixColor = VowkeyTheme.colorScheme.status.error,
    focusedSuffixColor = VowkeyTheme.colorScheme.text.secondary,
    unfocusedSuffixColor = VowkeyTheme.colorScheme.text.secondary,
    disabledSuffixColor = VowkeyTheme.colorScheme.outlineButton.foregroundDisabled,
    errorSuffixColor = VowkeyTheme.colorScheme.status.error,
)
