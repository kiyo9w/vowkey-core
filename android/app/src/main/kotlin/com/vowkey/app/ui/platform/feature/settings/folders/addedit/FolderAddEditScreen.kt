package com.vowkey.app.ui.platform.feature.settings.folders.addedit

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.collections.immutable.persistentListOf

/**
 * Displays the screen for adding or editing a folder item.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun FolderAddEditScreen(
    onNavigateBack: () -> Unit,
    viewModel: FolderAddEditViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    var shouldShowConfirmationDialog by rememberSaveable { mutableStateOf(false) }
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is FolderAddEditEvent.NavigateBack -> onNavigateBack.invoke()
        }
    }

    FolderAddEditItemDialogs(
        dialogState = state.dialog,
        onDismissRequest = { viewModel.trySendAction(FolderAddEditAction.DismissDialog) },
    )

    if (shouldShowConfirmationDialog) {
        VowkeyTwoButtonDialog(
            title = null,
            message = stringResource(id = VowkeyString.do_you_really_want_to_delete),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            confirmButtonText = stringResource(id = VowkeyString.delete),
            onDismissClick = { shouldShowConfirmationDialog = false },
            onConfirmClick = {
                shouldShowConfirmationDialog = false
                viewModel.trySendAction(FolderAddEditAction.DeleteClick)
            },
            onDismissRequest = { shouldShowConfirmationDialog = false },
            confirmTextColor = VowkeyTheme.colorScheme.status.error,
        )
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = state.screenDisplayName.invoke(),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(FolderAddEditAction.CloseClick) },
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        onClick = { viewModel.trySendAction(FolderAddEditAction.SaveClick) },
                        modifier = Modifier.testTag("SaveButton"),
                    )
                    VowkeyOverflowActionItem(
                        isVisible = state.shouldShowOverflowMenu,
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.delete),
                                onClick = { shouldShowConfirmationDialog = true },
                            ),
                        ),
                    )
                },
            )
        },
    ) {
        when (val viewState = state.viewState) {
            is FolderAddEditState.ViewState.Content -> {
                Column(
                    modifier = Modifier.fillMaxSize(),
                ) {
                    Spacer(modifier = Modifier.height(height = 12.dp))
                    VowkeyTextField(
                        label = stringResource(id = VowkeyString.name),
                        value = viewState.folderName,
                        onValueChange = {
                            viewModel.trySendAction(FolderAddEditAction.NameTextChange(it))
                        },
                        textFieldTestTag = "FolderNameField",
                        cardStyle = CardStyle.Full,
                        modifier = Modifier
                            .standardHorizontalMargin()
                            .fillMaxWidth(),
                    )
                    Spacer(modifier = Modifier.navigationBarsPadding())
                }
            }

            is FolderAddEditState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = viewState.message(),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is FolderAddEditState.ViewState.Loading -> {
                VowkeyLoadingContent(
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun FolderAddEditItemDialogs(
    dialogState: FolderAddEditState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is FolderAddEditState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.label())
        }

        is FolderAddEditState.DialogState.Error -> VowkeyBasicDialog(
            title = stringResource(id = VowkeyString.an_error_has_occurred),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
            throwable = dialogState.throwable,
        )

        null -> Unit
    }
}
