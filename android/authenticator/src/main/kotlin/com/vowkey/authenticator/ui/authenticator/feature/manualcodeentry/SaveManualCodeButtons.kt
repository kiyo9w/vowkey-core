package com.vowkey.authenticator.ui.authenticator.feature.manualcodeentry

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * Displays save buttons for saving a manually entered code.
 *
 * @param state State of the buttons to show.
 * @param onSaveLocallyClick Callback invoked when the user clicks save locally.
 * @param onSaveToVowkeyClick Callback invoked when the user clicks save to Vowkey.
 * @param modifier The modifier to be applied to the composable.
 */
@Composable
fun SaveManualCodeButtons(
    state: ManualCodeEntryState.ButtonState,
    onSaveLocallyClick: () -> Unit,
    onSaveToVowkeyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state) {
        ManualCodeEntryState.ButtonState.LocalOnly -> {
            VowkeyFilledButton(
                label = stringResource(id = VowkeyString.add_code),
                onClick = onSaveLocallyClick,
                modifier = modifier.testTag(tag = "AddCodeButton"),
            )
        }

        ManualCodeEntryState.ButtonState.SaveLocallyPrimary -> {
            Column(modifier = modifier) {
                VowkeyFilledButton(
                    label = stringResource(id = VowkeyString.save_here),
                    onClick = onSaveLocallyClick,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
                VowkeyOutlinedButton(
                    label = stringResource(VowkeyString.save_to_vowkey),
                    onClick = onSaveToVowkeyClick,
                    isExternalLink = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        ManualCodeEntryState.ButtonState.SaveToVowkeyPrimary -> {
            Column(modifier = modifier) {
                VowkeyFilledButton(
                    label = stringResource(id = VowkeyString.save_to_vowkey),
                    isExternalLink = true,
                    onClick = onSaveToVowkeyClick,
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
                VowkeyOutlinedButton(
                    label = stringResource(VowkeyString.save_here),
                    onClick = onSaveLocallyClick,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
