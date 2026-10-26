package com.vowkey.ui.platform.components.indicator

import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * A Vowkey-styled [CircularProgressIndicator].
 */
@Composable
fun VowkeyCircularProgressIndicator(
    modifier: Modifier = Modifier,
) {
    CircularProgressIndicator(
        modifier = modifier,
        color = VowkeyTheme.colorScheme.stroke.border,
        trackColor = VowkeyTheme.colorScheme.background.tertiary,
    )
}
