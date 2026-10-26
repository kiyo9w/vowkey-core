package com.vowkey.ui.platform.components.field

import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.nullableTestTag
import com.vowkey.ui.platform.components.field.color.vowkeyTextFieldColors
import com.vowkey.ui.platform.components.field.toolbar.VowkeyEmptyTextToolbar
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.util.passwordVisualTransformation
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey-styled password field that is completely hidden and non-interactable.
 *
 * @param label Label for the text field.
 * @param value Current text on the text field.
 * @param cardStyle Indicates the type of card style to be applied.
 * @param modifier Modifier for the composable.
 * @param passwordFieldTestTag The optional test tag associated with the inner password field.
 */
@Composable
fun VowkeyHiddenPasswordField(
    label: String?,
    value: String,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
    passwordFieldTestTag: String? = null,
) {
    CompositionLocalProvider(value = LocalTextToolbar provides VowkeyEmptyTextToolbar) {
        TextField(
            modifier = modifier
                .cardStyle(cardStyle = cardStyle, paddingVertical = 6.dp)
                .nullableTestTag(tag = passwordFieldTestTag),
            textStyle = VowkeyTheme.typography.sensitiveInfoSmall,
            label = label?.let { { Text(text = it) } },
            value = value,
            onValueChange = { },
            visualTransformation = passwordVisualTransformation(staticCharacterCount = 8),
            singleLine = true,
            enabled = false,
            readOnly = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
            colors = vowkeyTextFieldColors(),
        )
    }
}

@Preview
@Composable
private fun VowkeyHiddenPasswordField_preview() {
    VowkeyTheme {
        VowkeyHiddenPasswordField(
            label = "Label",
            value = "Password",
            cardStyle = CardStyle.Full,
        )
    }
}
