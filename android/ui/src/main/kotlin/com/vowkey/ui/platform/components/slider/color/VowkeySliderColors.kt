package com.vowkey.ui.platform.components.slider.color

import androidx.compose.material3.SliderColors
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Provides a default set of Vowkey-styled colors for sliders.
 */
@Composable
fun vowkeySliderColors(): SliderColors = SliderColors(
    thumbColor = VowkeyTheme.colorScheme.sliderButton.knobBackground,
    activeTrackColor = VowkeyTheme.colorScheme.sliderButton.filled,
    activeTickColor = Color.Transparent,
    inactiveTrackColor = VowkeyTheme.colorScheme.sliderButton.unfilled,
    inactiveTickColor = Color.Transparent,
    disabledThumbColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledActiveTrackColor = VowkeyTheme.colorScheme.filledButton.foregroundDisabled,
    disabledActiveTickColor = Color.Transparent,
    disabledInactiveTrackColor = VowkeyTheme.colorScheme.filledButton.backgroundDisabled,
    disabledInactiveTickColor = Color.Transparent,
)
