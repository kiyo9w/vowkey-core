package com.vowkey.ui.platform.components.scaffold.model

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember

/**
 * The state of the pull-to-refresh.
 */
data class VowkeyPullToRefreshState(
    val isEnabled: Boolean,
    val isRefreshing: Boolean,
    val onRefresh: () -> Unit,
)

/**
 * Create and remember the default [VowkeyPullToRefreshState].
 */
@Composable
fun rememberVowkeyPullToRefreshState(
    isEnabled: Boolean = false,
    isRefreshing: Boolean = false,
    onRefresh: () -> Unit = { },
): VowkeyPullToRefreshState = remember(isEnabled, isRefreshing, onRefresh) {
    VowkeyPullToRefreshState(
        isEnabled = isEnabled,
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
    )
}
