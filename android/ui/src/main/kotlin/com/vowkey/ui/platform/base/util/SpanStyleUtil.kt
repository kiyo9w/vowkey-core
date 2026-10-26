package com.vowkey.ui.platform.base.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextDecoration
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Creates a new [SpanStyle] from the specified [color] and [textStyle].
 */
fun spanStyleOf(
    color: Color,
    textStyle: TextStyle,
): SpanStyle =
    SpanStyle(
        color = color,
        fontSize = textStyle.fontSize,
        fontWeight = textStyle.fontWeight,
        fontStyle = textStyle.fontStyle,
        fontSynthesis = textStyle.fontSynthesis,
        fontFamily = textStyle.fontFamily,
        fontFeatureSettings = textStyle.fontFeatureSettings,
        letterSpacing = textStyle.letterSpacing,
        baselineShift = textStyle.baselineShift,
        textGeometricTransform = textStyle.textGeometricTransform,
        localeList = textStyle.localeList,
        background = textStyle.background,
        textDecoration = textStyle.textDecoration,
        shadow = textStyle.shadow,
        platformStyle = textStyle.platformStyle?.spanStyle,
        drawStyle = textStyle.drawStyle,
    )

/**
 * A [SpanStyle] representing "regular" text using the text primary color and label medium font.
 */
val vowkeyDefaultSpanStyle: SpanStyle
    @Composable
    @ReadOnlyComposable
    get() = spanStyleOf(
        color = VowkeyTheme.colorScheme.text.primary,
        textStyle = VowkeyTheme.typography.labelMedium,
    )

/**
 * A [SpanStyle] representing "bold" text using the text primary color and body medium emphasis
 * font.
 */
val vowkeyBoldSpanStyle: SpanStyle
    @Composable
    @ReadOnlyComposable
    get() = spanStyleOf(
        color = VowkeyTheme.colorScheme.text.primary,
        textStyle = VowkeyTheme.typography.bodyMediumEmphasis,
    )

/**
 * A [SpanStyle] representing "clickable" text using the text interaction color and label medium
 * font.
 */
val vowkeyClickableTextSpanStyle: SpanStyle
    @Composable
    @ReadOnlyComposable
    get() = spanStyleOf(
        color = VowkeyTheme.colorScheme.text.interaction,
        textStyle = VowkeyTheme.typography.labelMedium,
    )

/**
 * A [SpanStyle] representing "clickable" text in the focused state using the background alert
 * color and the underlined label medium font.
 */
val vowkeyClickableTextFocusSpanStyle: SpanStyle
    @Composable
    @ReadOnlyComposable
    get() = spanStyleOf(
        color = VowkeyTheme.colorScheme.background.alert,
        textStyle = VowkeyTheme.typography.labelMedium.copy(
            textDecoration = TextDecoration.Underline,
        ),
    )
