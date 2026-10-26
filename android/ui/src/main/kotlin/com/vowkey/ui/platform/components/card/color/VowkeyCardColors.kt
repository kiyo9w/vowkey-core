package com.vowkey.ui.platform.components.card.color

import androidx.compose.material3.CardColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for a card.
 */
@Composable
fun vowkeyCardColors(
    containerColor: Color = VowkeyTheme.colorScheme.background.tertiary,
    contentColor: Color = VowkeyTheme.colorScheme.text.primary,
    disabledContainerColor: Color = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledContentColor: Color = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
): CardColors {
    return CardColors(
        containerColor = containerColor,
        contentColor = contentColor,
        disabledContainerColor = disabledContainerColor,
        disabledContentColor = disabledContentColor,
    )
}
