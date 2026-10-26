package com.vowkey.app.ui.vault.feature.verificationcode

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.action.VowkeySearchActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.scaffold.model.rememberVowkeyPullToRefreshState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.manager.model.AppResumeScreenData
import com.vowkey.app.data.platform.manager.util.AppResumeStateManager
import com.vowkey.app.data.platform.manager.util.RegisterScreenDataOnLifecycleEffect
import com.vowkey.app.ui.platform.components.dialog.VowkeyMasterPasswordDialog
import com.vowkey.app.ui.platform.composition.LocalAppResumeStateManager
import com.vowkey.app.ui.vault.feature.item.VaultItemArgs
import com.vowkey.app.ui.vault.feature.verificationcode.handlers.VerificationCodeHandlers
import com.vowkey.app.ui.vault.model.VaultItemCipherType
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.persistentListOf
import kotlinx.collections.immutable.toImmutableList

/**
 * Displays the verification codes to the user.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VerificationCodeScreen(
    viewModel: VerificationCodeViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToVaultItemScreen: (args: VaultItemArgs) -> Unit,
    appResumeStateManager: AppResumeStateManager = LocalAppResumeStateManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val verificationCodeHandler = remember(viewModel) {
        VerificationCodeHandlers.create(viewModel)
    }

    val pullToRefreshState = rememberVowkeyPullToRefreshState(
        isEnabled = state.isPullToRefreshEnabled,
        isRefreshing = state.isRefreshing,
        onRefresh = { viewModel.trySendAction(VerificationCodeAction.RefreshPull) },
    )

    RegisterScreenDataOnLifecycleEffect(
        appResumeStateManager = appResumeStateManager,
    ) {
        AppResumeScreenData.VerificationCodeScreen
    }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is VerificationCodeEvent.NavigateBack -> onNavigateBack()
            is VerificationCodeEvent.NavigateToVaultItem -> {
                onNavigateToVaultItemScreen(VaultItemArgs(event.id, VaultItemCipherType.LOGIN))
            }

            is VerificationCodeEvent.NavigateToVaultSearchScreen -> {
                onNavigateToSearch()
            }
        }
    }

    VerificationCodeDialogs(
        dialogState = state.dialogState,
        onDismissRequest = verificationCodeHandler.dismissDialog,
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.verification_codes),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = verificationCodeHandler.backClick,
                actions = {
                    VowkeySearchActionItem(
                        contentDescription = stringResource(id = VowkeyString.search_vault),
                        onClick = verificationCodeHandler.searchIconClick,
                    )
                    VowkeyOverflowActionItem(
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.sync),
                                onClick = verificationCodeHandler.syncClick,
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.lock),
                                onClick = verificationCodeHandler.lockClick,
                            ),
                        ),
                    )
                },
            )
        },
        pullToRefreshState = pullToRefreshState,
    ) {
        when (val viewState = state.viewState) {
            is VerificationCodeState.ViewState.Content -> {
                VerificationCodeContent(
                    items = viewState.verificationCodeDisplayItems.toImmutableList(),
                    onCopyClick = verificationCodeHandler.copyClick,
                    onItemClick = verificationCodeHandler.itemClick,
                    onMasterPasswordRepromptSubmit = verificationCodeHandler
                        .masterPasswordRepromptSubmit,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is VerificationCodeState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = viewState.message.invoke(),
                    buttonData = VowkeyButtonData(
                        label = VowkeyString.try_again.asText(),
                        onClick = verificationCodeHandler.refreshClick,
                    ),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is VerificationCodeState.ViewState.Loading -> {
                VowkeyLoadingContent(modifier = Modifier.fillMaxSize())
            }
        }
    }
}

@Composable
private fun VerificationCodeDialogs(
    dialogState: VerificationCodeState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is VerificationCodeState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                throwable = dialogState.throwable,
                onDismissRequest = onDismissRequest,
            )
        }

        is VerificationCodeState.DialogState.Loading -> {
            VowkeyLoadingDialog(
                text = dialogState.message(),
            )
        }

        null -> Unit
    }
}

@Composable
private fun VerificationCodeContent(
    items: ImmutableList<VerificationCodeDisplayItem>,
    onItemClick: (id: String) -> Unit,
    onMasterPasswordRepromptSubmit: (id: String, password: String) -> Unit,
    onCopyClick: (text: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    var masterPasswordRepromptId by remember { mutableStateOf<String?>(value = null) }
    masterPasswordRepromptId?.let { id ->
        VowkeyMasterPasswordDialog(
            onConfirmClick = { password ->
                onMasterPasswordRepromptSubmit(id, password)
                masterPasswordRepromptId = null
            },
            onDismissRequest = { masterPasswordRepromptId = null },
        )
    }
    LazyColumn(
        modifier = modifier,
    ) {
        item {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.items),
                supportingLabel = items.size.toString(),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        itemsIndexed(items) { index, it ->
            VaultVerificationCodeItem(
                startIcon = it.startIcon,
                label = it.label,
                supportingLabel = it.supportingLabel,
                timeLeftSeconds = it.timeLeftSeconds,
                periodSeconds = it.periodSeconds,
                authCode = it.authCode,
                hideAuthCode = it.hideAuthCode,
                onCopyClick = { onCopyClick(it.authCode) },
                onItemClick = {
                    if (it.hideAuthCode) {
                        masterPasswordRepromptId = it.id
                    } else {
                        onItemClick(it.id)
                    }
                },
                cardStyle = items.toListItemCardStyle(index = index, dividerPadding = 56.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
