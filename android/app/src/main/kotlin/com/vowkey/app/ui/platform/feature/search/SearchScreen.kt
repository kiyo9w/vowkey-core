package com.vowkey.app.ui.platform.feature.search

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.appbar.VowkeySearchTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.data.platform.manager.model.AppResumeScreenData
import com.vowkey.app.data.platform.manager.util.AppResumeStateManager
import com.vowkey.app.data.platform.manager.util.RegisterScreenDataOnLifecycleEffect
import com.vowkey.app.ui.platform.composition.LocalAppResumeStateManager
import com.vowkey.app.ui.platform.feature.search.handlers.SearchHandlers
import com.vowkey.app.ui.tools.feature.send.addedit.AddEditSendRoute
import com.vowkey.app.ui.tools.feature.send.addedit.ModeType
import com.vowkey.app.ui.tools.feature.send.viewsend.ViewSendRoute
import com.vowkey.app.ui.vault.feature.addedit.VaultAddEditArgs
import com.vowkey.app.ui.vault.feature.item.VaultItemArgs
import com.vowkey.app.ui.vault.feature.vault.VaultFilter
import com.vowkey.app.ui.vault.model.VaultAddEditType
import kotlinx.collections.immutable.toImmutableList

/**
 * The search UI for vault items or send items.
 */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(
    onNavigateBack: () -> Unit,
    onNavigateToAddEditSend: (route: AddEditSendRoute) -> Unit,
    onNavigateToViewSend: (route: ViewSendRoute) -> Unit,
    onNavigateToEditCipher: (args: VaultAddEditArgs) -> Unit,
    onNavigateToViewCipher: (args: VaultItemArgs) -> Unit,
    onNavigateToPlan: () -> Unit,
    onNavigateToSecrets: (String, String?) -> Unit = { _, _ -> },
    intentManager: IntentManager = LocalIntentManager.current,
    viewModel: SearchViewModel = hiltViewModel(),
    appResumeStateManager: AppResumeStateManager = LocalAppResumeStateManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val searchHandlers = remember(viewModel) { SearchHandlers.create(viewModel) }
    RegisterScreenDataOnLifecycleEffect(
        appResumeStateManager = appResumeStateManager,
    ) {
        AppResumeScreenData.SearchScreen(
            searchTerm = state.searchTerm,
        )
    }

    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is SearchEvent.NavigateToSecrets -> onNavigateToSecrets(event.kind, event.id)
            SearchEvent.NavigateBack -> onNavigateBack()
            is SearchEvent.NavigateToEditSend -> {
                onNavigateToAddEditSend(
                    AddEditSendRoute(
                        sendType = event.sendType,
                        modeType = ModeType.EDIT,
                        sendId = event.sendId,
                    ),
                )
            }

            is SearchEvent.NavigateToViewSend -> {
                onNavigateToViewSend(
                    ViewSendRoute(sendId = event.sendId, sendType = event.sendType),
                )
            }

            is SearchEvent.NavigateToEditCipher -> {
                onNavigateToEditCipher(
                    VaultAddEditArgs(
                        vaultAddEditType = VaultAddEditType.EditItem(vaultItemId = event.cipherId),
                        vaultItemCipherType = event.cipherType,
                    ),
                )
            }

            is SearchEvent.NavigateToViewCipher -> {
                onNavigateToViewCipher(
                    VaultItemArgs(
                        vaultItemId = event.cipherId,
                        cipherType = event.cipherType,
                    ),
                )
            }

            is SearchEvent.NavigateToUrl -> intentManager.launchUri(event.url.toUri())
            SearchEvent.NavigateToPlanModal -> onNavigateToPlan()
            is SearchEvent.ShowShareSheet -> intentManager.shareText(event.content)
            is SearchEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    SearchDialogs(
        dialogState = state.dialogState,
        onDismissRequest = searchHandlers.onDismissRequest,
        onUpgradeToPremiumClick = searchHandlers.onUpgradeToPremiumClick,
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        topBar = {
            VowkeySearchTopAppBar(
                searchTerm = state.searchTerm,
                placeholder = state.searchType.title(),
                onSearchTermChange = searchHandlers.onSearchTermChange,
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = searchHandlers.onBackClick,
                ),
                clearIconContentDescription = stringResource(id = VowkeyString.clear),
            )
        },
        utilityBar = {
            val vaultFilterData = state.vaultFilterData
            if (state.viewState.hasVaultFilter && vaultFilterData != null) {
                VaultFilter(
                    selectedVaultFilterType = vaultFilterData.selectedVaultFilterType,
                    vaultFilterTypes = vaultFilterData.vaultFilterTypes.toImmutableList(),
                    onVaultFilterTypeSelect = searchHandlers.onVaultFilterSelect,
                    topAppBarScrollBehavior = scrollBehavior,
                    modifier = Modifier
                        .padding(
                            start = 16.dp,
                            // There is some built-in padding to the menu button that makes up
                            // the visual difference here.
                            end = 12.dp,
                        )
                        .fillMaxWidth(),
                )
            }
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
        modifier = Modifier
            .nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        when (val viewState = state.viewState) {
            is SearchState.ViewState.Content -> SearchContent(
                viewState = viewState,
                searchHandlers = searchHandlers,
                searchType = state.searchType,
                modifier = Modifier
                    .fillMaxSize(),
            )

            is SearchState.ViewState.Empty -> SearchEmptyContent(
                viewState = viewState,
                modifier = Modifier
                    .fillMaxSize(),
            )

            is SearchState.ViewState.Error -> VowkeyErrorContent(
                message = viewState.message(),
                modifier = Modifier
                    .fillMaxSize(),
            )

            SearchState.ViewState.Loading -> VowkeyLoadingContent(
                modifier = Modifier
                    .fillMaxSize(),
            )
        }
    }
}

@Composable
private fun SearchDialogs(
    dialogState: SearchState.DialogState?,
    onDismissRequest: () -> Unit,
    onUpgradeToPremiumClick: () -> Unit,
) {
    when (dialogState) {
        SearchState.DialogState.ArchiveRequiresPremium -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.premium_subscription_required),
                message = stringResource(id = VowkeyString.archiving_items_is_a_premium_feature),
                confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = onUpgradeToPremiumClick,
                onDismissClick = onDismissRequest,
                onDismissRequest = onDismissRequest,
            )
        }

        is SearchState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
            throwable = dialogState.throwable,
        )

        is SearchState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        null -> Unit
    }
}
