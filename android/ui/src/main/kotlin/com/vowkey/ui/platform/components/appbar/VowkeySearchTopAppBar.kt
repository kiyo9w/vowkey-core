package com.vowkey.ui.platform.components.appbar

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import com.vowkey.ui.platform.base.util.bottomDivider
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.base.util.mirrorIfRtl
import com.vowkey.ui.platform.base.util.tabNavigation
import com.vowkey.ui.platform.components.appbar.color.vowkeyTopAppBarColors
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.field.color.vowkeyTextFieldColors
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Represents a Vowkey styled [TopAppBar] that assumes the following components:
 *
 * - an optional single navigation control in the upper-left defined by [navigationIcon].
 * - an editable [TextField] populated by a [searchTerm] in the middle.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun VowkeySearchTopAppBar(
    searchTerm: String,
    placeholder: String,
    onSearchTermChange: (String) -> Unit,
    scrollBehavior: TopAppBarScrollBehavior,
    navigationIcon: NavigationIcon?,
    clearIconContentDescription: String,
    modifier: Modifier = Modifier,
    windowInsets: WindowInsets = TopAppBarDefaults.windowInsets
        .union(WindowInsets.displayCutout.only(WindowInsetsSides.Horizontal)),
    autoFocus: Boolean = true,
) {
    val focusRequester = remember { FocusRequester() }
    TopAppBar(
        modifier = modifier
            .testTag(tag = "HeaderBarComponent")
            .bottomDivider(),
        windowInsets = windowInsets,
        colors = vowkeyTopAppBarColors(),
        scrollBehavior = scrollBehavior,
        navigationIcon = {
            navigationIcon?.let {
                VowkeyStandardIconButton(
                    painter = it.navigationIcon,
                    contentDescription = it.navigationIconContentDescription,
                    onClick = it.onNavigationIconClick,
                    modifier = Modifier
                        .testTag(tag = "CloseButton")
                        .mirrorIfRtl(),
                )
            }
        },
        title = {
            val interactionSource = remember { MutableInteractionSource() }
            TextField(
                colors = vowkeyTextFieldColors(),
                textStyle = VowkeyTheme.typography.bodyLarge,
                placeholder = { Text(text = placeholder) },
                value = searchTerm,
                singleLine = true,
                onValueChange = onSearchTermChange,
                trailingIcon = {
                    AnimatedVisibility(
                        visible = searchTerm.isNotEmpty(),
                        enter = scaleIn() + fadeIn(),
                        exit = scaleOut() + fadeOut(),
                    ) {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_clear,
                            contentDescription = clearIconContentDescription,
                            onClick = { onSearchTermChange("") },
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                interactionSource = interactionSource,
                modifier = Modifier
                    .tabNavigation()
                    .interactiveBorder(
                        interactionSource = interactionSource,
                        shape = VowkeyTheme.shapes.content,
                    )
                    .testTag("SearchFieldEntry")
                    .focusRequester(focusRequester)
                    .fillMaxWidth(),
            )
        },
    )
    if (autoFocus) {
        LaunchedEffect(Unit) { focusRequester.requestFocus() }
    }
}
