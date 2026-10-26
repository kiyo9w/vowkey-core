package com.vowkey.ui.platform.components.appbar.action

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.tooling.preview.Preview
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.resource.VowkeyDrawable

/**
 * Represents the Vowkey search action item.
 *
 * This is an [Icon] composable tailored specifically for the search functionality
 * in the Vowkey app.
 * It presents the search icon and offers an `onClick` callback for when the icon is tapped.
 *
 * @param contentDescription A description of the UI element, used for accessibility purposes.
 * @param isDisplayed Whether this action item should be displayed.
 * @param onClick A callback to be invoked when this action item is clicked.
 */
@Composable
fun VowkeySearchActionItem(
    contentDescription: String,
    isDisplayed: Boolean = true,
    onClick: () -> Unit,
) {
    if (!isDisplayed) return
    VowkeyStandardIconButton(
        vectorIconRes = VowkeyDrawable.ic_search,
        contentDescription = contentDescription,
        onClick = onClick,
        modifier = Modifier.testTag(tag = "SearchButton"),
    )
}

@Preview(showBackground = true)
@Composable
private fun VowkeySearchActionItem_preview() {
    VowkeySearchActionItem(
        contentDescription = "Search",
        onClick = {},
    )
}
