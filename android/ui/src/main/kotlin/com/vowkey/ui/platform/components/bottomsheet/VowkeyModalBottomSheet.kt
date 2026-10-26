package com.vowkey.ui.platform.components.bottomsheet

import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SheetState
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.SemanticsPropertyKey
import androidx.compose.ui.semantics.SemanticsPropertyReceiver
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.coroutines.launch
import org.jetbrains.annotations.VisibleForTesting

/**
 * A reusable modal bottom sheet that applies provides a bottom sheet layout with the
 * standard [VowkeyScaffold] and [VowkeyTopAppBar] and expected scrolling behavior with
 * passed in [sheetContent]
 *
 * @param sheetTitle The title to display in the [VowkeyTopAppBar]
 * @param onDismiss The action to perform when the bottom sheet is dismissed will also be performed
 * when the "close" icon is clicked, caller must handle any desired animation or hiding of the
 * bottom sheet. This will be invoked _after_ the sheet has been animated away.
 * @param topBarActions Row of actions to add the top bar of the bottom sheet.
 * @param showBottomSheet Whether to show the bottom sheet, by default this is true assuming
 * the showing/hiding will be handled by the caller.
 * @param sheetContent Content to display in the bottom sheet. The content is passed the padding
 * from the containing [VowkeyScaffold] and a `onDismiss` lambda to be used for manual dismissal
 * that will include the dismissal animation.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyModalBottomSheet(
    sheetTitle: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
    topBarActions: @Composable RowScope.(animatedOnDismiss: () -> Unit) -> Unit = {},
    showBottomSheet: Boolean = true,
    sheetState: SheetState = rememberModalBottomSheetState(),
    sheetContent: @Composable (animatedOnDismiss: () -> Unit) -> Unit,
) {
    if (!showBottomSheet) return
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        modifier = modifier.semantics { this.IsBottomSheet = true },
        dragHandle = null,
        sheetState = sheetState,
        contentWindowInsets = {
            WindowInsets(left = 0, top = 0, right = 0, bottom = 0)
        },
        shape = VowkeyTheme.shapes.bottomSheet,
    ) {
        val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
        val animatedOnDismiss = sheetState.createAnimatedDismissAction(onDismiss = onDismiss)
        VowkeyScaffold(
            topBar = {
                VowkeyTopAppBar(
                    title = sheetTitle,
                    navigationIcon = NavigationIcon(
                        navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
                        onNavigationIconClick = animatedOnDismiss,
                        navigationIconContentDescription = stringResource(VowkeyString.close),
                    ),
                    actions = {
                        topBarActions(animatedOnDismiss)
                    },
                    scrollBehavior = scrollBehavior,
                    minimumHeight = 64.dp,
                )
            },
            modifier = Modifier
                .nestedScroll(scrollBehavior.nestedScrollConnection)
                .fillMaxSize(),
        ) {
            sheetContent(animatedOnDismiss)
        }
    }
}

/**
 * SemanticPropertyKey used for Unit tests where checking if the content is part of a bottom sheet.
 */
@VisibleForTesting
val IsBottomSheetKey = SemanticsPropertyKey<Boolean>("IsBottomSheet")
private var SemanticsPropertyReceiver.IsBottomSheet by IsBottomSheetKey

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SheetState.createAnimatedDismissAction(onDismiss: () -> Unit): () -> Unit {
    val scope = rememberCoroutineScope()
    return {
        scope
            .launch { this@createAnimatedDismissAction.hide() }
            .invokeOnCompletion { onDismiss() }
    }
}
