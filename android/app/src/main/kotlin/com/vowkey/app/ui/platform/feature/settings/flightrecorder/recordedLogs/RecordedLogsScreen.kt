package com.vowkey.app.ui.platform.feature.settings.flightrecorder.recordedLogs

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.content.VowkeyEmptyContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.collections.immutable.persistentListOf

/**
 * Displays the flight recorder recorded logs screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun RecordedLogsScreen(
    onNavigateBack: () -> Unit,
    viewModel: RecordedLogsViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel) { event ->
        when (event) {
            RecordedLogsEvent.NavigateBack -> onNavigateBack()
            is RecordedLogsEvent.ShareLog -> {
                intentManager.shareFile(fileUri = event.uri.toUri())
            }

            is RecordedLogsEvent.ShowSnackbar -> {
                snackbarHostState.showSnackbar(
                    snackbarData = VowkeySnackbarData(message = event.text),
                )
            }
        }
    }

    RecordedLogsDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(RecordedLogsAction.DismissDialog) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.recorded_logs_title),
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(RecordedLogsAction.BackClick) },
                scrollBehavior = scrollBehavior,
                actions = {
                    RecordedLogsOverflowMenu(
                        isOverflowEnabled = state.viewState.isOverflowEnabled,
                        onDeleteAllClick = {
                            viewModel.trySendAction(RecordedLogsAction.DeleteAllClick)
                        },
                        onShareAllClick = {
                            viewModel.trySendAction(RecordedLogsAction.ShareAllClick)
                        },
                    )
                },
            )
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        when (val viewState = state.viewState) {
            is RecordedLogsState.ViewState.Content -> {
                RecordedLogsContent(
                    viewState = viewState,
                    onShareItemClick = {
                        viewModel.trySendAction(RecordedLogsAction.ShareClick(it))
                    },
                    onDeleteItemClick = {
                        viewModel.trySendAction(RecordedLogsAction.DeleteClick(it))
                    },
                )
            }

            RecordedLogsState.ViewState.Empty -> {
                VowkeyEmptyContent(
                    text = stringResource(id = VowkeyString.no_logs_recorded),
                    illustrationData = IconData.Local(
                        iconRes = VowkeyDrawable.ill_secure_devices,
                    ),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            RecordedLogsState.ViewState.Loading -> {
                VowkeyLoadingContent(modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun RecordedLogsOverflowMenu(
    isOverflowEnabled: Boolean,
    onDeleteAllClick: () -> Unit,
    onShareAllClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showDeletionDialog by rememberSaveable { mutableStateOf(value = false) }
    if (showDeletionDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.delete_logs),
            message = stringResource(
                id = VowkeyString.do_you_really_want_to_delete_all_recorded_logs,
            ),
            confirmButtonText = stringResource(id = VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onDismissRequest = { showDeletionDialog = false },
            onDismissClick = { showDeletionDialog = false },
            onConfirmClick = {
                onDeleteAllClick()
                showDeletionDialog = false
            },
        )
    }
    VowkeyOverflowActionItem(
        modifier = modifier,
        menuItemDataList = persistentListOf(
            OverflowMenuItemData(
                text = stringResource(id = VowkeyString.share_all),
                onClick = onShareAllClick,
                isEnabled = isOverflowEnabled,
            ),
            OverflowMenuItemData(
                text = stringResource(id = VowkeyString.delete_all),
                onClick = { showDeletionDialog = true },
                isEnabled = isOverflowEnabled,
                color = VowkeyTheme.colorScheme.status.error,
            ),
        ),
    )
}

@Composable
private fun RecordedLogsDialogs(
    dialogState: RecordedLogsState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is RecordedLogsState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                throwable = dialogState.error,
                onDismissRequest = onDismissRequest,
            )
        }

        null -> Unit
    }
}

@Composable
private fun RecordedLogsContent(
    viewState: RecordedLogsState.ViewState.Content,
    onDeleteItemClick: (RecordedLogsState.DisplayItem) -> Unit,
    onShareItemClick: (RecordedLogsState.DisplayItem) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        item(key = "top_spacer") {
            Spacer(modifier = Modifier.height(height = 12.dp))
        }

        itemsIndexed(
            items = viewState.items,
            key = { _, item -> item.toString() },
        ) { index, item ->
            LogRow(
                displayableItem = item,
                cardStyle = viewState.items.toListItemCardStyle(index = index),
                onDeleteItemClick = onDeleteItemClick,
                onShareItemClick = onShareItemClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }

        item(key = "bottom_spacer") {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Suppress("LongMethod")
@Composable
private fun LogRow(
    displayableItem: RecordedLogsState.DisplayItem,
    onDeleteItemClick: (RecordedLogsState.DisplayItem) -> Unit,
    onShareItemClick: (RecordedLogsState.DisplayItem) -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    var showDeletionDialog by rememberSaveable { mutableStateOf(value = false) }
    if (showDeletionDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.delete_log),
            message = stringResource(id = VowkeyString.do_you_really_want_to_delete_this_log),
            confirmButtonText = stringResource(id = VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onDismissRequest = { showDeletionDialog = false },
            onDismissClick = { showDeletionDialog = false },
            onConfirmClick = {
                onDeleteItemClick(displayableItem)
                showDeletionDialog = false
            },
        )
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .defaultMinSize(minHeight = 60.dp)
            .cardStyle(
                cardStyle = cardStyle,
                paddingTop = 12.dp,
                paddingBottom = 12.dp,
                paddingStart = 16.dp,
                paddingEnd = 4.dp,
            )
            .testTag("LogRow"),
    ) {
        Column(modifier = Modifier.weight(weight = 1f)) {
            Text(
                text = displayableItem.title(),
                style = VowkeyTheme.typography.bodyLarge,
                color = VowkeyTheme.colorScheme.text.primary,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("LogNameLabel"),
            )
            Spacer(modifier = Modifier.height(height = 2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = displayableItem.subtextStart(),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.text.secondary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier
                        .weight(weight = 1f)
                        .testTag("LogSizeLabel"),
                )
                displayableItem.subtextEnd?.let {
                    Spacer(modifier = Modifier.width(width = 4.dp))
                    Text(
                        text = it(),
                        style = VowkeyTheme.typography.bodyMedium,
                        color = VowkeyTheme.colorScheme.text.secondary,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        textAlign = TextAlign.End,
                        modifier = Modifier
                            .weight(weight = 1f)
                            .testTag("LogExpirationLabel"),
                    )
                }
            }
        }
        Spacer(modifier = Modifier.width(width = 12.dp))
        VowkeyOverflowActionItem(
            menuItemDataList = persistentListOf(
                OverflowMenuItemData(
                    text = stringResource(id = VowkeyString.share),
                    onClick = { onShareItemClick(displayableItem) },
                    testTag = "LogShareButton",
                ),
                OverflowMenuItemData(
                    text = stringResource(id = VowkeyString.delete),
                    onClick = { showDeletionDialog = true },
                    color = VowkeyTheme.colorScheme.status.error,
                    isEnabled = displayableItem.isDeletedEnabled,
                    testTag = "LogDeleteButton",
                ),
            ),
            vectorIconRes = VowkeyDrawable.ic_ellipsis_horizontal,
            testTag = "Options",
        )
    }
}
