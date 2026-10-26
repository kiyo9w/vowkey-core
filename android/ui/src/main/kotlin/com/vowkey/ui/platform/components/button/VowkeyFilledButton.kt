package com.vowkey.ui.platform.components.button

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonColors
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.painter.Painter
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.nullableTestTag
import com.vowkey.ui.platform.components.button.color.vowkeyFilledButtonColors
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.components.util.throttledClick
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled filled [Button].
 *
 * @param buttonData The data for the button.
 * @param modifier The [Modifier] to be applied to the button.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 * @param colors The colors for the button.
 * @param cardStyle The optional card style to surround the button.
 * @param cardInsets The internal insets for the card, only applied when the [cardStyle] is not
 * `null`.
 */
@Composable
fun VowkeyFilledButton(
    buttonData: VowkeyButtonData,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    colors: ButtonColors = vowkeyFilledButtonColors(),
    cardStyle: CardStyle? = null,
    cardInsets: PaddingValues = PaddingValues(horizontal = 16.dp),
) {
    VowkeyFilledButton(
        label = buttonData.label(),
        onClick = buttonData.onClick,
        icon = buttonData.icon,
        isExternalLink = buttonData.isExternalLink,
        isEnabled = buttonData.isEnabled,
        cardStyle = cardStyle,
        colors = colors,
        cardInsets = cardInsets,
        interactionSource = interactionSource,
        modifier = modifier.nullableTestTag(tag = buttonData.testTag),
    )
}

/**
 * Represents a Vowkey-styled filled [Button].
 *
 * @param label The label for the button.
 * @param onClick The callback when the button is clicked.
 * @param modifier The [Modifier] to be applied to the button.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 * @param icon The icon for the button.
 * @param isEnabled Whether the button is enabled.
 * @param isExternalLink Indicates that this button launches an external link.
 * @param colors The colors for the button.
 * @param cardStyle The optional card style to surround the button.
 * @param cardInsets The internal insets for the card, only applied when the [cardStyle] is not
 * `null`.
 */
@Composable
fun VowkeyFilledButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    icon: Painter? = null,
    isEnabled: Boolean = true,
    isExternalLink: Boolean = false,
    colors: ButtonColors = vowkeyFilledButtonColors(),
    cardStyle: CardStyle? = null,
    cardInsets: PaddingValues = PaddingValues(horizontal = 16.dp),
) {
    val formattedContentDescription = if (isExternalLink) {
        stringResource(
            id = VowkeyString.external_link_format,
            formatArgs = arrayOf(label),
        )
    } else {
        label
    }
    VowkeyBaseButton(
        modifier = modifier
            .semantics(mergeDescendants = true) {
                contentDescription = formattedContentDescription
            }
            .cardStyle(cardStyle = cardStyle, padding = cardInsets),
        onClick = throttledClick(onClick = onClick),
        enabled = isEnabled,
        contentPadding = PaddingValues(
            top = 10.dp,
            bottom = 10.dp,
            start = if (icon == null) 24.dp else 16.dp,
            end = 24.dp,
        ),
        shape = VowkeyTheme.shapes.button,
        colors = colors,
        focusColor = colors.contentColor,
        interactionSource = interactionSource,
    ) {
        icon?.let {
            Icon(
                painter = icon,
                contentDescription = null,
            )
            Spacer(modifier = Modifier.width(8.dp))
        }
        Text(
            text = label,
            style = VowkeyTheme.typography.labelLarge,
            modifier = Modifier.semantics { hideFromAccessibility() },
        )
    }
}

@Preview
@Composable
private fun VowkeyFilledButton_preview() {
    Column {
        VowkeyFilledButton(
            label = "Label",
            onClick = {},
            icon = null,
            isEnabled = true,
        )
        VowkeyFilledButton(
            label = "Label",
            onClick = {},
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_question_circle),
            isEnabled = true,
        )
        VowkeyFilledButton(
            label = "Label",
            onClick = {},
            icon = null,
            isEnabled = false,
        )
        VowkeyFilledButton(
            label = "Label",
            onClick = {},
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_question_circle),
            isEnabled = false,
        )
    }
}
