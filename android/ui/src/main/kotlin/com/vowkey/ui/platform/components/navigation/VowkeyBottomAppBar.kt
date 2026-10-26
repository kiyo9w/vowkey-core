package com.vowkey.ui.platform.components.navigation

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.BottomAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import com.vowkey.ui.platform.base.util.topDivider
import com.vowkey.ui.platform.components.navigation.model.NavigationItem
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.collections.immutable.ImmutableList

/**
 * A custom Vowkey-themed bottom app bar.
 */
@Composable
fun VowkeyBottomAppBar(
    navigationItems: ImmutableList<NavigationItem>,
    selectedItem: NavigationItem?,
    onClick: (NavigationItem) -> Unit,
    modifier: Modifier = Modifier,
    windowInsets: WindowInsets = BottomAppBarDefaults.windowInsets,
) {
    BottomAppBar(
        containerColor = VowkeyTheme.colorScheme.background.secondary,
        contentColor = Color.Unspecified,
        windowInsets = windowInsets,
        modifier = modifier.topDivider(),
    ) {
        navigationItems.forEach { navigationItem ->
            VowkeyNavigationBarItem(
                labelRes = navigationItem.labelRes,
                selectedIconRes = navigationItem.iconResSelected,
                unselectedIconRes = navigationItem.iconRes,
                notificationCount = navigationItem.notificationCount,
                isSelected = selectedItem == navigationItem,
                onClick = { onClick(navigationItem) },
                modifier = Modifier.testTag(tag = navigationItem.testTag),
            )
        }
    }
}
