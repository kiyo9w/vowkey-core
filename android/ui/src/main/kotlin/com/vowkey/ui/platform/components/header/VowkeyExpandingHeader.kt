package com.vowkey.ui.platform.components.header

import androidx.compose.animation.Crossfade
import androidx.compose.animation.core.AnimationConstants
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.minimumInteractiveComponentSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.platform.LocalLocale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.toUpperCase
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Reusable header element that is clickable for expanding or collapsing content.
 *
 * @param collapsedText Text to display when the content is collapsed.
 * @param expandedText Text to display when the content is expanded.
 * @param showExpansionIndicator Whether to show an indicator to expand or collapse the content.
 * @param modifier modifier for the composable.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 */
@Suppress("LongMethod")
@Composable
fun VowkeyExpandingHeader(
    isExpanded: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    collapsedText: String = stringResource(id = VowkeyString.additional_options),
    expandedText: String = collapsedText,
    showExpansionIndicator: Boolean = true,
    shape: Shape = VowkeyTheme.shapes.content,
    insets: PaddingValues = PaddingValues(top = 16.dp, bottom = 8.dp),
    capitalizeText: Boolean = false,
) {
    Row(
        modifier = modifier
            .clip(shape = shape)
            .interactiveBorder(interactionSource = interactionSource, shape = shape)
            .clickable(
                onClickLabel = stringResource(
                    id = if (isExpanded) VowkeyString.collapse else VowkeyString.expand,
                ),
                onClick = onClick,
                interactionSource = interactionSource,
                role = Role.Button,
            )
            .minimumInteractiveComponentSize()
            .padding(horizontal = 16.dp)
            .padding(paddingValues = insets)
            .semantics(mergeDescendants = true) { heading() },
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Crossfade(
            targetState = isExpanded,
            label = "VowkeyExpandingHeaderTitle_animation",
            // Make the animation shorter when the text is the same to avoid crossfading the same
            // text.
            animationSpec = tween(
                durationMillis = if (expandedText != collapsedText) {
                    AnimationConstants.DefaultDurationMillis
                } else {
                    0
                },
            ),
            modifier = Modifier.weight(weight = 1f, fill = false),
        ) { expanded ->
            if (expanded) {
                Text(
                    text = if (capitalizeText) {
                        expandedText.toUpperCase(locale = LocalLocale.current)
                    } else {
                        expandedText
                    },
                    color = VowkeyTheme.colorScheme.text.interaction,
                    style = VowkeyTheme.typography.labelLarge,
                    modifier = Modifier.padding(end = 8.dp),
                )
            } else {
                Text(
                    text = if (capitalizeText) {
                        collapsedText.toUpperCase(locale = LocalLocale.current)
                    } else {
                        collapsedText
                    },
                    color = VowkeyTheme.colorScheme.text.interaction,
                    style = VowkeyTheme.typography.labelLarge,
                    modifier = Modifier.padding(end = 8.dp),
                )
            }
        }
        if (showExpansionIndicator) {
            val iconRotationDegrees = animateFloatAsState(
                targetValue = if (isExpanded) 0f else 180f,
                label = "expanderIconRotationAnimation",
            )
            Icon(
                painter = rememberVectorPainter(id = VowkeyDrawable.ic_chevron_up_small),
                contentDescription = null,
                tint = VowkeyTheme.colorScheme.icon.secondary,
                modifier = Modifier.rotate(degrees = iconRotationDegrees.value),
            )
        }
    }
}
