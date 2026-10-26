package com.vowkey.authenticator.ui.authenticator.feature.search

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.authenticator.ui.authenticator.feature.search.handlers.SearchHandlers
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.bottomDivider
import com.vowkey.ui.platform.components.appbar.VowkeySearchTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * The search screen for authenticator items.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemSearchScreen(
    viewModel: ItemSearchViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToEdit: (String) -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val searchHandlers = remember(viewModel) { SearchHandlers.create(viewModel) }
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is ItemSearchEvent.NavigateBack -> onNavigateBack()
            is ItemSearchEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            is ItemSearchEvent.NavigateToEditItem -> onNavigateToEdit(event.itemId)
        }
    }

    ItemSearchDialogs(
        dialogState = state.dialog,
        searchHandlers = searchHandlers,
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeySearchTopAppBar(
                modifier = Modifier
                    .testTag("SearchFieldEntry")
                    .bottomDivider(),
                searchTerm = state.searchTerm,
                placeholder = stringResource(id = VowkeyString.search_codes),
                onSearchTermChange = searchHandlers.onSearchTermChange,
                scrollBehavior = scrollBehavior,
                clearIconContentDescription = stringResource(id = VowkeyString.clear),
                navigationIcon = NavigationIcon(
                    navigationIcon = painterResource(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = searchHandlers.onBackClick,
                ),
            )
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        when (val viewState = state.viewState) {
            is ItemSearchState.ViewState.Content -> {
                ItemSearchContent(
                    viewState = viewState,
                    searchHandlers = searchHandlers,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is ItemSearchState.ViewState.Empty -> {
                ItemSearchEmptyContent(
                    viewState = viewState,
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun ItemSearchDialogs(
    dialogState: ItemSearchState.DialogState?,
    searchHandlers: SearchHandlers,
) {
    when (dialogState) {
        is ItemSearchState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                throwable = dialogState.throwable,
                onDismissRequest = searchHandlers.onDismissDialog,
            )
        }

        is ItemSearchState.DialogState.DeleteConfirmationPrompt -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.delete),
                message = dialogState.message(),
                confirmButtonText = stringResource(id = VowkeyString.okay),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = { searchHandlers.onConfirmDeleteClick(dialogState.itemId) },
                onDismissClick = searchHandlers.onDismissDialog,
                onDismissRequest = searchHandlers.onDismissDialog,
            )
        }

        ItemSearchState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = stringResource(id = VowkeyString.loading))
        }

        null -> Unit
    }
}
