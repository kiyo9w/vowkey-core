package com.vowkey.ui.platform.components.badge

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.platform.theme.color.VowkeyColorScheme

/**
 * A reusable status badge composable that displays a colored pill with a label.
 *
 * @param label The text to display in the badge.
 * @param colors The border, background, and text colors for the badge.
 * @param modifier The [Modifier] to apply to this badge.
 */
@Composable
fun VowkeyStatusBadge(
    label: String,
    colors: VowkeyColorScheme.StatusBadgeVariantColors,
    modifier: Modifier = Modifier,
) {
    Surface(
        shape = VowkeyTheme.shapes.badge,
        color = colors.background,
        modifier = modifier
            .height(24.dp)
            .border(
                width = 1.dp,
                color = colors.border,
                shape = VowkeyTheme.shapes.badge,
            ),
    ) {
        Text(
            text = label,
            style = VowkeyTheme.typography.labelMedium,
            color = colors.text,
            modifier = Modifier.padding(
                horizontal = 8.dp,
                vertical = 4.dp,
            ),
        )
    }
}

@OmitFromCoverage
@Preview
@Composable
private fun VowkeyStatusBadge_Preview() {
    VowkeyTheme {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            VowkeyStatusBadge(
                label = "Active",
                colors = VowkeyTheme.colorScheme.statusBadge.success,
            )
            VowkeyStatusBadge(
                label = "Canceled",
                colors = VowkeyTheme.colorScheme.statusBadge.error,
            )
            VowkeyStatusBadge(
                label = "Update payment",
                colors = VowkeyTheme.colorScheme.statusBadge.warning,
            )
        }
    }
}

@OmitFromCoverage
@Preview
@Composable
private fun VowkeyStatusBadge_PreviewDark() {
    VowkeyTheme(theme = AppTheme.DARK) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            VowkeyStatusBadge(
                label = "Active",
                colors = VowkeyTheme.colorScheme.statusBadge.success,
            )
            VowkeyStatusBadge(
                label = "Canceled",
                colors = VowkeyTheme.colorScheme.statusBadge.error,
            )
            VowkeyStatusBadge(
                label = "Update payment",
                colors = VowkeyTheme.colorScheme.statusBadge.warning,
            )
        }
    }
}
