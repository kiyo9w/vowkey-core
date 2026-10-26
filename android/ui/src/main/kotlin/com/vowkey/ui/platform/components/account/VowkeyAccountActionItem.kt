package com.vowkey.ui.platform.components.account

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.R
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.base.util.toSafeOverlayColor
import com.vowkey.ui.platform.base.util.toUnscaledTextUnit
import com.vowkey.ui.platform.components.button.color.vowkeyStandardIconButtonColors
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Displays an icon representing a Vowkey account with the user's initials superimposed.
 * The icon is typically a colored circle with the initials centered on it.
 *
 * @param initials The initials of the user to be displayed on top of the icon.
 * @param color The color to be applied as the tint for the icon.
 * @param onClick An action to be invoked when the icon is clicked.
 * @param modifier A [Modifier] for the composable.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 */
@Composable
fun VowkeyAccountActionItem(
    initials: String,
    color: Color,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
) {
    val iconPainter = rememberVectorPainter(id = VowkeyDrawable.ic_account_initials_container)
    val contentDescription = stringResource(id = VowkeyString.account)
    IconButton(
        onClick = onClick,
        colors = vowkeyStandardIconButtonColors(),
        interactionSource = interactionSource,
        modifier = modifier
            .interactiveBorder(
                interactionSource = interactionSource,
                shape = VowkeyTheme.shapes.button,
            )
            .testTag(tag = "CurrentActiveAccount"),
    ) {
        Icon(
            painter = iconPainter,
            contentDescription = contentDescription,
            tint = color,
        )
        Text(
            text = initials,
            style = TextStyle(
                fontSize = 11.dp.toUnscaledTextUnit(),
                lineHeight = 13.dp.toUnscaledTextUnit(),
                fontFamily = FontFamily(Font(R.font.dm_sans_bold)),
                fontWeight = FontWeight.W600,
            ),
            color = color.toSafeOverlayColor(),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun VowkeyAccountActionItem_preview() {
    VowkeyTheme {
        VowkeyAccountActionItem(
            initials = "BW",
            color = VowkeyTheme.colorScheme.icon.primary,
            onClick = {},
        )
    }
}
