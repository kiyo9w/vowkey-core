package com.vowkey.ui.platform.components.coachmark

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Clickable text used for the standard action UI for a Coach Mark which applies
 * correct text style by default.
 */
@Composable
fun CoachMarkActionText(
    actionLabel: String,
    onActionClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    VowkeyClickableText(
        label = actionLabel,
        onClick = onActionClick,
        style = VowkeyTheme.typography.labelLarge,
        modifier = modifier,
    )
}
