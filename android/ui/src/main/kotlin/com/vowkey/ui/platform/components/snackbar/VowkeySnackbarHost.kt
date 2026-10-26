package com.vowkey.ui.platform.components.snackbar

import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.SnackbarHost
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarHostState

/**
 * A custom Vowkey-themed snackbar.
 *
 * @param vowkeyHostState The state of this snackbar.
 * @param modifier The [Modifier] to be applied to the [SnackbarHost].
 * @param windowInsets The insets to be applied to this composable. By default this will account for
 * the insets that are on the sides and bottom of the screen (Display Cutout and Navigation bars).
 */
@Composable
fun VowkeySnackbarHost(
    vowkeyHostState: VowkeySnackbarHostState,
    modifier: Modifier = Modifier,
    windowInsets: WindowInsets = WindowInsets.displayCutout
        .only(sides = WindowInsetsSides.Horizontal + WindowInsetsSides.Bottom)
        .union(insets = WindowInsets.navigationBars),
) {
    SnackbarHost(
        hostState = vowkeyHostState.snackbarHostState,
        modifier = modifier
            .windowInsetsPadding(insets = windowInsets)
            .consumeWindowInsets(insets = windowInsets),
    ) { snackbarData ->
        val message = snackbarData.visuals.message
        val currentCustomSnackbarData = vowkeyHostState.currentSnackbarData
        if (currentCustomSnackbarData?.key == message) {
            VowkeySnackbar(
                vowkeySnackbarData = currentCustomSnackbarData,
                onDismiss = snackbarData::dismiss,
                onActionClick = snackbarData::performAction,
            )
        }
    }
}
