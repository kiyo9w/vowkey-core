package com.vowkey.ui.platform.components.account

import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.tooling.preview.Preview
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.components.button.color.vowkeyStandardIconButtonColors
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * A placeholder item to be used to represent an account.
 *
 * @param onClick An action to be invoked when the icon is clicked.
 * @param modifier A [Modifier] for the composable.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 */
@Composable
fun VowkeyPlaceholderAccountActionItem(
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
) {
    IconButton(
        onClick = onClick,
        colors = vowkeyStandardIconButtonColors(),
        shape = VowkeyTheme.shapes.button,
        interactionSource = interactionSource,
        modifier = modifier
            .interactiveBorder(
                interactionSource = interactionSource,
                shape = VowkeyTheme.shapes.button,
            )
            .semantics(mergeDescendants = true) { testTag = "CurrentActiveAccount" },
    ) {
        Icon(
            painter = rememberVectorPainter(
                id = VowkeyDrawable.ic_account_initials_container,
            ),
            contentDescription = null,
            tint = VowkeyTheme.colorScheme.background.tertiary,
        )
        Icon(
            painter = rememberVectorPainter(id = VowkeyDrawable.ic_dots),
            contentDescription = stringResource(id = VowkeyString.account),
            tint = VowkeyTheme.colorScheme.text.interaction,
        )
    }
}

@Preview
@Composable
private fun VowkeyPlaceholderAccountActionItem_preview_light() {
    VowkeyTheme(theme = AppTheme.LIGHT) {
        VowkeyPlaceholderAccountActionItem(
            onClick = {},
        )
    }
}

@Preview
@Composable
private fun VowkeyPlaceholderAccountActionItem_preview_dark() {
    VowkeyTheme(theme = AppTheme.DARK) {
        VowkeyPlaceholderAccountActionItem(
            onClick = {},
        )
    }
}
