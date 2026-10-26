package com.vowkey.ui.platform.components.navigation

import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.RowScope
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.components.badge.NotificationBadge
import com.vowkey.ui.platform.components.navigation.color.vowkeyNavigationBarItemColors
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyPlurals
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * A custom Vowkey-themed bottom app bar item.
 *
 * @param labelRes The custom label for the navigation item.
 * @param selectedIconRes The icon to be displayed when the navigation item is selected.
 * @param unselectedIconRes The icon to be displayed when the navigation item is not selected.
 * @param isSelected Indicates that the navigation item is selected.
 * @param onClick The lambda to be invoked when the navigation item is clicked.
 * @param modifier A [Modifier] that you can use to apply custom modifications to the composable.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 * @param notificationCount The notification count for the navigation item.
 */
@Suppress("LongMethod")
@Composable
fun RowScope.VowkeyNavigationBarItem(
    @StringRes labelRes: Int,
    @DrawableRes selectedIconRes: Int,
    @DrawableRes unselectedIconRes: Int,
    isSelected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    notificationCount: Int = 0,
) {
    NavigationBarItem(
        icon = {
            BadgedBox(
                badge = {
                    NotificationBadge(
                        notificationCount = notificationCount,
                        isVisible = notificationCount > 0,
                    )
                },
            ) {
                Icon(
                    painter = rememberVectorPainter(
                        id = if (isSelected) selectedIconRes else unselectedIconRes,
                    ),
                    contentDescription = null,
                    tint = if (isSelected) {
                        // This is unspecified because selected icons are multi-tonal.
                        Color.Unspecified
                    } else {
                        VowkeyTheme.colorScheme.icon.primary
                    },
                )
            }
        },
        label = {
            val label = stringResource(id = labelRes)
            val notifications = pluralStringResource(
                id = VowkeyPlurals.notifications_content_description,
                count = notificationCount,
                formatArgs = arrayOf(notificationCount),
            )
            Text(
                text = label,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.semantics {
                    // The NavigationBarItem will clear any icon semantics when the label is
                    // present, so we have to add the notification count manually here.
                    contentDescription = if (notificationCount > 0) {
                        "$label, $notifications"
                    } else {
                        label
                    }
                },
            )
        },
        selected = isSelected,
        onClick = onClick,
        colors = vowkeyNavigationBarItemColors(),
        interactionSource = interactionSource,
        modifier = modifier.interactiveBorder(
            interactionSource = interactionSource,
            shape = VowkeyTheme.shapes.button,
        ),
    )
}
