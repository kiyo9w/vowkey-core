package com.vowkey.ui.platform.components.content

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.icon.VowkeyIcon
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * A Vowkey-themed, re-usable error state.
 *
 * @param message The text content to display.
 * @param modifier The [Modifier] to be applied to the layout.
 * @param illustrationData Optional illustration to display above the text.
 * @param buttonData Optional button to display below the text.
 */
@Composable
fun VowkeyErrorContent(
    message: String,
    modifier: Modifier = Modifier,
    illustrationData: IconData? = null,
    buttonData: VowkeyButtonData? = null,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        illustrationData?.let {
            VowkeyIcon(
                iconData = it,
                modifier = Modifier.size(size = 124.dp),
            )
            Spacer(modifier = Modifier.height(height = 24.dp))
        }
        Text(
            text = message,
            color = VowkeyTheme.colorScheme.text.primary,
            style = VowkeyTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth(),
        )
        buttonData?.let {
            Spacer(modifier = Modifier.height(16.dp))
            VowkeyFilledButton(
                buttonData = it,
                modifier = Modifier.padding(horizontal = 16.dp),
            )
        }
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}
