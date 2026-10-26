package com.vowkey.ui.platform.components.card

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Card
import androidx.compose.material3.CardColors
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.VectorPainter
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.components.card.color.vowkeyCardColors
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.platform.theme.animation.focusAnimationSpec
import com.vowkey.ui.platform.theme.ripple.NoFocusRippleConfig

/**
 * A reusable card for displaying actions to the user.
 */
@Composable
fun VowkeyActionCardSmall(
    actionIcon: VectorPainter,
    actionText: String,
    callToActionText: String,
    onCardClicked: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    callToActionTextColor: Color = VowkeyTheme.colorScheme.text.primary,
    colors: CardColors = vowkeyCardColors(),
    trailingContent: (@Composable BoxScope.() -> Unit)? = null,
) {
    val isFocused by interactionSource.collectIsFocusedAsState()
    val borderWidth by animateDpAsState(
        targetValue = if (isFocused) 2.dp else 1.dp,
        animationSpec = focusAnimationSpec(),
    )
    CompositionLocalProvider(LocalRippleConfiguration provides NoFocusRippleConfig) {
        Card(
            onClick = onCardClicked,
            shape = VowkeyTheme.shapes.actionCard,
            colors = colors,
            elevation = CardDefaults.elevatedCardElevation(),
            border = BorderStroke(
                width = borderWidth,
                color = VowkeyTheme.colorScheme.stroke.border,
            ),
            interactionSource = interactionSource,
            modifier = modifier
                .interactiveBorder(
                    interactionSource = interactionSource,
                    shape = VowkeyTheme.shapes.actionCard,
                    inset = 4.dp,
                )
                .semantics { this.role = Role.Button },
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
            ) {
                Icon(
                    painter = actionIcon,
                    contentDescription = null,
                    tint = VowkeyTheme.colorScheme.icon.secondary,
                    modifier = Modifier.size(24.dp),
                )
                Spacer(modifier = Modifier.width(16.dp))
                Column(modifier = Modifier.weight(weight = 1f)) {
                    Text(
                        text = actionText,
                        style = VowkeyTheme.typography.titleMedium,
                        color = VowkeyTheme.colorScheme.text.primary,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = callToActionText,
                        style = VowkeyTheme.typography.bodyMedium,
                        color = callToActionTextColor,
                    )
                }
                Spacer(modifier = Modifier.width(16.dp))
                Box(modifier = Modifier.align(Alignment.CenterVertically)) {
                    trailingContent?.invoke(this)
                }
            }
        }
    }
}

@Preview
@Composable
private fun ActionCardSmall_preview() {
    VowkeyTheme {
        VowkeyActionCardSmall(
            actionIcon = rememberVectorPainter(id = VowkeyDrawable.ic_generate),
            actionText = "This is an action.",
            callToActionText = "Take action",
            onCardClicked = { },
        )
    }
}

@Preview
@Composable
private fun ActionCardSmallWithTrailingIcon_preview() {
    VowkeyTheme {
        VowkeyActionCardSmall(
            actionIcon = rememberVectorPainter(id = VowkeyDrawable.ic_generate),
            actionText = "An action with trailing content",
            callToActionText = "Take action",
            onCardClicked = {},
            trailingContent = {
                Icon(
                    painter = rememberVectorPainter(id = VowkeyDrawable.ic_chevron_right),
                    contentDescription = null,
                    tint = VowkeyTheme.colorScheme.icon.primary,
                )
            },
        )
    }
}
