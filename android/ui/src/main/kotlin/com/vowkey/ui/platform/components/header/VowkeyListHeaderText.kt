package com.vowkey.ui.platform.components.header

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled label text.
 *
 * @param label The text content for the label.
 * @param supportingLabel The optional text for the supporting label.
 * @param modifier The [Modifier] to be applied to the label.
 */
@Composable
fun VowkeyListHeaderText(
    label: String,
    modifier: Modifier = Modifier,
    supportingLabel: String? = null,
) {
    val supportLabel = supportingLabel?.let { " ($it)" }.orEmpty()
    Text(
        text = "${label.uppercase()}$supportLabel",
        style = VowkeyTheme.typography.eyebrowMedium,
        color = VowkeyTheme.colorScheme.text.secondary,
        modifier = modifier.semantics { heading() },
    )
}

@Preview(showBackground = true)
@Composable
private fun VowkeyListHeaderText_preview() {
    VowkeyTheme {
        Column {
            VowkeyListHeaderText(
                label = "Sample Label",
                modifier = Modifier,
            )
            VowkeyListHeaderText(
                label = "Sample Label",
                supportingLabel = "4",
                modifier = Modifier,
            )
        }
    }
}
