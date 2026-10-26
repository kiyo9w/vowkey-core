package com.vowkey.ui.platform.components.snackbar

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.color.vowkeyOutlinedButtonColors
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText

/**
 * Custom snackbar for Vowkey.
 *
 * @param vowkeySnackbarData The data required to display the Snackbar.
 * @param modifier The [Modifier] to be applied to the button.
 * @param windowInsets The insets to be applied to this composable. By default this will account for
 * the insets that are on the sides and bottom of the screen (Display Cutout and Navigation bars).
 * @param onDismiss The callback invoked when the Snackbar is dismissed.
 * @param onActionClick The callback invoked when the Snackbar action occurs.
 */
@Suppress("LongMethod")
@Composable
fun VowkeySnackbar(
    vowkeySnackbarData: VowkeySnackbarData,
    modifier: Modifier = Modifier,
    windowInsets: WindowInsets = WindowInsets.displayCutout
        .only(sides = WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom)
        .union(insets = WindowInsets.navigationBars),
    onDismiss: () -> Unit = {},
    onActionClick: () -> Unit = {},
) {
    Box(
        modifier = modifier
            .windowInsetsPadding(insets = windowInsets)
            .consumeWindowInsets(insets = windowInsets)
            .padding(12.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .background(
                    color = VowkeyTheme.colorScheme.background.alert,
                    shape = VowkeyTheme.shapes.snackbar,
                )
                // I there is no explicit dismiss action, the Snackbar can be dismissed by clicking
                // anywhere on the Snackbar.
                .clickable(
                    enabled = !vowkeySnackbarData.withDismissAction,
                    onClick = onDismiss,
                ),
        ) {
            Column(
                modifier = Modifier
                    .padding(top = 16.dp, bottom = 16.dp, start = 16.dp)
                    .weight(weight = 1f),
            ) {
                vowkeySnackbarData.messageHeader?.let {
                    Text(
                        text = it(),
                        color = VowkeyTheme.colorScheme.text.reversed,
                        style = VowkeyTheme.typography.titleSmall,
                    )
                    Spacer(Modifier.height(4.dp))
                }
                Text(
                    text = vowkeySnackbarData.message(),
                    color = VowkeyTheme.colorScheme.text.reversed,
                    style = if (vowkeySnackbarData.messageHeader != null) {
                        VowkeyTheme.typography.bodyMedium
                    } else {
                        // Upgrade the font when it is stand alone.
                        VowkeyTheme.typography.titleSmall
                    },
                )
                vowkeySnackbarData.actionLabel?.let {
                    Spacer(Modifier.height(12.dp))
                    VowkeyOutlinedButton(
                        label = it(),
                        onClick = onActionClick,
                        colors = vowkeyOutlinedButtonColors(
                            contentColor = VowkeyTheme.colorScheme.text.reversed,
                            outlineColor = VowkeyTheme
                                .colorScheme
                                .outlineButton
                                .borderReversed,
                        ),
                    )
                }
            }
            if (vowkeySnackbarData.withDismissAction) {
                VowkeyStandardIconButton(
                    onClick = onDismiss,
                    vectorIconRes = VowkeyDrawable.ic_close,
                    contentDescription = stringResource(VowkeyString.close),
                    contentColor = VowkeyTheme.colorScheme.icon.reversed,
                    focusColor = VowkeyTheme.colorScheme.icon.reversed,
                )
            }
        }
    }
}

@Preview
@Composable
private fun VowkeyCustomSnackbar_preview() {
    VowkeyTheme {
        Surface {
            VowkeySnackbar(
                VowkeySnackbarData(
                    messageHeader = "Header".asText(),
                    message = "Message".asText(),
                    actionLabel = "Action".asText(),
                    withDismissAction = true,
                ),
            )
        }
    }
}
