package com.vowkey.app.ui.platform.feature.settings.folders

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.fab.VowkeyFloatingActionButton
import com.vowkey.ui.platform.components.row.VowkeyTextRow
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.composition.util.vfo1Foundation
import com.vowkey.app.ui.platform.feature.settings.folders.model.FolderDisplayItem
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.toImmutableList

/**
 * Displays the folders screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FoldersScreen(
    onNavigateBack: () -> Unit,
    onNavigateToAddFolderScreen: () -> Unit,
    onNavigateToEditFolderScreen: (folderId: String) -> Unit,
    viewModel: FoldersViewModel = hiltViewModel(),
) {
    val state = viewModel.stateFlow.collectAsStateWithLifecycle()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is FoldersEvent.NavigateBack -> onNavigateBack()
            is FoldersEvent.NavigateToAddFolderScreen -> onNavigateToAddFolderScreen()
            is FoldersEvent.NavigateToEditFolderScreen -> {
                onNavigateToEditFolderScreen(event.folderId)
            }

            is FoldersEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(
                    id = vfo1Foundation(VowkeyString.my_folders, VowkeyString.folders),
                ),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(FoldersAction.CloseButtonClick) },
            )
        },
        floatingActionButton = {
            VowkeyFloatingActionButton(
                onClick = { viewModel.trySendAction(FoldersAction.AddFolderButtonClick) },
                painter = rememberVectorPainter(id = VowkeyDrawable.ic_plus_large),
                contentDescription = stringResource(id = VowkeyString.add_item),
                modifier = Modifier
                    .testTag(tag = "AddItemButton")
                    .navigationBarsPadding(),
            )
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        when (val viewState = state.value.viewState) {
            is FoldersState.ViewState.Content -> {
                FoldersContent(
                    foldersList = viewState.folderList.toImmutableList(),
                    onItemClick = { viewModel.trySendAction(FoldersAction.FolderClick(it)) },
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is FoldersState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = viewState.message(),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is FoldersState.ViewState.Loading -> {
                VowkeyLoadingContent(
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun FoldersContent(
    foldersList: ImmutableList<FolderDisplayItem>,
    onItemClick: (folderId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (foldersList.isEmpty()) {
        Column(
            modifier = modifier,
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = stringResource(id = VowkeyString.no_folders_to_list),
                textAlign = TextAlign.Center,
                style = VowkeyTheme.typography.bodyMedium,
                color = VowkeyTheme.colorScheme.text.primary,
                modifier = Modifier.testTag("NoFoldersLabel"),
            )
        }
    } else {
        LazyColumn(
            modifier = modifier,
        ) {
            item {
                Spacer(modifier = Modifier.height(height = 12.dp))
            }
            itemsIndexed(foldersList) { index, it ->
                VowkeyTextRow(
                    text = it.name,
                    onClick = { onItemClick(it.id) },
                    textTestTag = "FolderName",
                    cardStyle = foldersList.toListItemCardStyle(index = index),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .testTag(tag = "FolderCell"),
                )
            }
            item {
                Spacer(modifier = Modifier.height(height = 88.dp))
                Spacer(modifier = Modifier.navigationBarsPadding())
            }
        }
    }
}
