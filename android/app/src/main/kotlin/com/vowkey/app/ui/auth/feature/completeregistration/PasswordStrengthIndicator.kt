package com.vowkey.app.ui.auth.feature.completeregistration

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyPlurals
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText

/**
 * Draws a password indicator that displays password strength based on the given [state].
 */
@Suppress("LongMethod", "CyclomaticComplexMethod", "MagicNumber")
@Composable
fun PasswordStrengthIndicator(
    state: PasswordStrengthState,
    currentCharacterCount: Int,
    modifier: Modifier = Modifier,
    minimumCharacterCount: Int? = null,
) {
    val minimumRequirementMet = (minimumCharacterCount == null) ||
        (currentCharacterCount >= minimumCharacterCount)
    val widthPercent by animateFloatAsState(
        targetValue = if (minimumRequirementMet) {
            when (state) {
                PasswordStrengthState.NONE -> 0f
                PasswordStrengthState.WEAK_1 -> .25f
                PasswordStrengthState.WEAK_2 -> .5f
                PasswordStrengthState.WEAK_3 -> .66f
                PasswordStrengthState.GOOD -> .82f
                PasswordStrengthState.STRONG -> 1f
            }
        } else {
            0f
        },
        label = "Width Percent State",
    )
    val indicatorColor = when (state) {
        PasswordStrengthState.NONE -> VowkeyTheme.colorScheme.status.error
        PasswordStrengthState.WEAK_1 -> VowkeyTheme.colorScheme.status.error
        PasswordStrengthState.WEAK_2 -> VowkeyTheme.colorScheme.status.weak2
        PasswordStrengthState.WEAK_3 -> VowkeyTheme.colorScheme.status.weak2
        PasswordStrengthState.GOOD -> VowkeyTheme.colorScheme.status.good
        PasswordStrengthState.STRONG -> VowkeyTheme.colorScheme.status.strong
    }
    val animatedIndicatorColor by animateColorAsState(
        targetValue = indicatorColor,
        label = "Indicator Color State",
    )
    val label = when (state) {
        PasswordStrengthState.NONE -> "".asText()
        PasswordStrengthState.WEAK_1 -> VowkeyString.weak.asText()
        PasswordStrengthState.WEAK_2 -> VowkeyString.weak.asText()
        PasswordStrengthState.WEAK_3 -> VowkeyString.weak.asText()
        PasswordStrengthState.GOOD -> VowkeyString.good.asText()
        PasswordStrengthState.STRONG -> VowkeyString.strong.asText()
    }
    Column(
        modifier = modifier,
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(4.dp)
                .clip(shape = VowkeyTheme.shapes.progressIndicator)
                .background(VowkeyTheme.colorScheme.sliderButton.unfilled),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxHeight()
                    .fillMaxWidth()
                    .graphicsLayer {
                        transformOrigin = TransformOrigin(pivotFractionX = 0f, pivotFractionY = 0f)
                        scaleX = widthPercent
                    }
                    .drawBehind {
                        drawRect(animatedIndicatorColor)
                    },
            )
        }
        Spacer(Modifier.height(4.dp))
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            minimumCharacterCount?.let { minCount ->
                MinimumCharacterCount(
                    minimumRequirementMet = currentCharacterCount >= minCount,
                    minimumCharacterCount = minCount,
                )
            }
            if (minimumRequirementMet) {
                Text(
                    text = label(),
                    style = VowkeyTheme.typography.labelSmall,
                    color = indicatorColor,
                )
            }
        }
    }
}

@Composable
private fun MinimumCharacterCount(
    modifier: Modifier = Modifier,
    minimumRequirementMet: Boolean,
    minimumCharacterCount: Int,
) {
    Row(
        modifier = modifier,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        AnimatedContent(
            targetState = if (minimumRequirementMet) {
                VowkeyDrawable.ic_plain_checkmark
            } else {
                VowkeyDrawable.ic_circle
            },
            label = "iconForMinimumCharacterCount",
        ) {
            Icon(
                painter = rememberVectorPainter(id = it),
                contentDescription = null,
                tint = VowkeyTheme.colorScheme.text.secondary,
                modifier = Modifier.size(12.dp),
            )
        }
        Spacer(modifier = Modifier.width(2.dp))
        Text(
            text = pluralStringResource(
                id = VowkeyPlurals.minimum_characters,
                count = minimumCharacterCount,
                formatArgs = arrayOf(minimumCharacterCount),
            ),
            color = VowkeyTheme.colorScheme.text.secondary,
            style = VowkeyTheme.typography.labelSmall,
        )
    }
}

/**
 * Models various levels of password strength that can be displayed by [PasswordStrengthIndicator].
 */
enum class PasswordStrengthState {
    NONE,
    WEAK_1,
    WEAK_2,
    WEAK_3,
    GOOD,
    STRONG,
}

@Preview(showBackground = true)
@Composable
private fun PasswordStrengthIndicatorPreview_minCharMet() {
    VowkeyTheme {
        PasswordStrengthIndicator(
            state = PasswordStrengthState.WEAK_3,
            currentCharacterCount = 12,
            minimumCharacterCount = 12,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PasswordStrengthIndicatorPreview_minCharNotMet() {
    VowkeyTheme {
        PasswordStrengthIndicator(
            state = PasswordStrengthState.WEAK_3,
            currentCharacterCount = 11,
            minimumCharacterCount = 12,
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun PasswordStrengthIndicatorPreview_noMinChar() {
    VowkeyTheme {
        PasswordStrengthIndicator(
            state = PasswordStrengthState.WEAK_3,
            currentCharacterCount = 12,
        )
    }
}
