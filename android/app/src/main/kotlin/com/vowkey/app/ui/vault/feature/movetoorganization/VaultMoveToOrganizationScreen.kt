package com.vowkey.app.ui.vault.feature.movetoorganization

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.model.VaultCollection

/**
 * Displays the vault move to organization screen.
 */
@Composable
fun VaultMoveToOrganizationScreen(
    viewModel: VaultMoveToOrganizationViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is VaultMoveToOrganizationEvent.NavigateBack -> onNavigateBack()
        }
    }
    VaultMoveToOrganizationScaffold(
        state = state,
        closeClick = { viewModel.trySendAction(VaultMoveToOrganizationAction.BackClick) },
        moveClick = { viewModel.trySendAction(VaultMoveToOrganizationAction.MoveClick) },
        dismissClick = { viewModel.trySendAction(VaultMoveToOrganizationAction.DismissClick) },
        organizationSelect = {
            viewModel.trySendAction(VaultMoveToOrganizationAction.OrganizationSelect(it))
        },
        collectionSelect = {
            viewModel.trySendAction(VaultMoveToOrganizationAction.CollectionSelect(it))
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
private fun VaultMoveToOrganizationScaffold(
    state: VaultMoveToOrganizationState,
    closeClick: () -> Unit,
    moveClick: () -> Unit,
    dismissClick: () -> Unit,
    organizationSelect: (VaultMoveToOrganizationState.ViewState.Content.Organization) -> Unit,
    collectionSelect: (VaultCollection) -> Unit,
) {
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    when (val dialog = state.dialogState) {
        is VaultMoveToOrganizationState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.an_error_has_occurred),
                message = dialog.message(),
                onDismissRequest = dismissClick,
                throwable = dialog.throwable,
            )
        }

        is VaultMoveToOrganizationState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialog.message())
        }

        null -> Unit
    }
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = state.appBarText(),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = closeClick,
                actions = {
                    VowkeyTextButton(
                        label = state.appBarButtonText(),
                        onClick = moveClick,
                        isEnabled = state.viewState is
                            VaultMoveToOrganizationState.ViewState.Content,
                        modifier = Modifier.testTag("MoveButton"),
                    )
                },
            )
        },
    ) {
        val modifier = Modifier
            .fillMaxSize()
        when (state.viewState) {
            is VaultMoveToOrganizationState.ViewState.Content -> {
                VaultMoveToOrganizationContent(
                    state = state.viewState,
                    showOnlyCollections = state.onlyShowCollections,
                    organizationSelect = organizationSelect,
                    collectionSelect = collectionSelect,
                    modifier = modifier,
                )
            }

            is VaultMoveToOrganizationState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = state.viewState.message(),
                    modifier = modifier,
                )
            }

            is VaultMoveToOrganizationState.ViewState.Loading -> {
                VowkeyLoadingContent(modifier = modifier)
            }

            is VaultMoveToOrganizationState.ViewState.Empty -> {
                VaultMoveToOrganizationEmpty(modifier = modifier)
            }
        }
    }
}
