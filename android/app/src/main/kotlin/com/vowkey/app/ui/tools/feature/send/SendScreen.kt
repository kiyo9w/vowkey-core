package com.vowkey.app.ui.tools.feature.send

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.action.VowkeySearchActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeySelectionDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dialog.row.VowkeyBasicDialogRow
import com.vowkey.ui.platform.components.fab.VowkeyFloatingActionButton
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.scaffold.model.rememberVowkeyPullToRefreshState
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import com.vowkey.app.data.platform.manager.model.AppResumeScreenData
import com.vowkey.app.data.platform.manager.util.AppResumeStateManager
import com.vowkey.app.data.platform.manager.util.RegisterScreenDataOnLifecycleEffect
import com.vowkey.app.ui.platform.composition.LocalAppResumeStateManager
import com.vowkey.app.ui.platform.feature.search.model.SearchType
import com.vowkey.app.ui.tools.feature.send.addedit.AddEditSendRoute
import com.vowkey.app.ui.tools.feature.send.addedit.ModeType
import com.vowkey.app.ui.tools.feature.send.handlers.SendHandlers
import com.vowkey.app.ui.tools.feature.send.model.SendItemType
import com.vowkey.app.ui.tools.feature.send.model.UpgradedToPremiumCardData
import com.vowkey.app.ui.tools.feature.send.util.selectionText
import com.vowkey.app.ui.tools.feature.send.viewsend.ViewSendRoute
import kotlinx.collections.immutable.persistentListOf

/**
 * UI for the send screen.
 */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SendScreen(
    onNavigateToAddEditSend: (AddEditSendRoute) -> Unit,
    onNavigateToViewSend: (ViewSendRoute) -> Unit,
    onNavigateToSendFilesList: () -> Unit,
    onNavigateToSendTextList: () -> Unit,
    onNavigateToSearchSend: (searchType: SearchType.Sends) -> Unit,
    onNavigateToPlan: () -> Unit,
    viewModel: SendViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    appResumeStateManager: AppResumeStateManager = LocalAppResumeStateManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val pullToRefreshState = rememberVowkeyPullToRefreshState(
        isEnabled = state.isPullToRefreshEnabled,
        isRefreshing = state.isRefreshing,
        onRefresh = { viewModel.trySendAction(SendAction.RefreshPull) },
    )

    RegisterScreenDataOnLifecycleEffect(
        appResumeStateManager = appResumeStateManager,
    ) {
        AppResumeScreenData.SendScreen
    }

    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is SendEvent.NavigateToSearch -> onNavigateToSearchSend(SearchType.Sends.All)

            is SendEvent.NavigateNewSend -> {
                onNavigateToAddEditSend(
                    AddEditSendRoute(modeType = ModeType.ADD, sendType = event.sendType),
                )
            }

            is SendEvent.NavigateToEditSend -> {
                onNavigateToAddEditSend(
                    AddEditSendRoute(
                        modeType = ModeType.EDIT,
                        sendType = event.sendType,
                        sendId = event.sendId,
                    ),
                )
            }

            is SendEvent.NavigateToViewSend -> {
                onNavigateToViewSend(
                    ViewSendRoute(sendId = event.sendId, sendType = event.sendType),
                )
            }

            is SendEvent.NavigateToAboutSend -> {
                intentManager.launchUri("https://vowkey.com/products/send".toUri())
            }

            is SendEvent.ShowShareSheet -> intentManager.shareText(event.url)
            is SendEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            SendEvent.NavigateToFileSends -> onNavigateToSendFilesList()
            SendEvent.NavigateToTextSends -> onNavigateToSendTextList()
            is SendEvent.NavigateToUrl -> intentManager.launchUri(event.url.toUri())
            SendEvent.NavigateToPlanModal -> onNavigateToPlan()
        }
    }

    SendDialogs(
        dialogState = state.dialogState,
        onAddSendSelected = { viewModel.trySendAction(SendAction.AddSendSelected(it)) },
        onUpgradeToPremiumClick = {
            viewModel.trySendAction(SendAction.UpgradeToPremiumClick)
        },
        onDismissRequest = { viewModel.trySendAction(SendAction.DismissDialog) },
    )

    val sendHandlers = remember(viewModel) { SendHandlers.create(viewModel) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(
        state = rememberTopAppBarState(),
    )
    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyMediumTopAppBar(
                title = stringResource(id = VowkeyString.send),
                scrollBehavior = scrollBehavior,
                actions = {
                    VowkeySearchActionItem(
                        contentDescription = stringResource(id = VowkeyString.search_sends),
                        isDisplayed = state.shouldShowSearchIcon,
                        onClick = { viewModel.trySendAction(SendAction.SearchClick) },
                    )
                    VowkeyOverflowActionItem(
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.sync),
                                onClick = { viewModel.trySendAction(SendAction.SyncClick) },
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.lock),
                                onClick = { viewModel.trySendAction(SendAction.LockClick) },
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.about_send),
                                onClick = { viewModel.trySendAction(SendAction.AboutSendClick) },
                                isExternalLink = true,
                            ),
                        ),
                    )
                },
            )
        },
        floatingActionButton = {
            AnimatedVisibility(
                visible = state.viewState.shouldDisplayFab,
                enter = scaleIn(),
                exit = scaleOut(),
            ) {
                VowkeyFloatingActionButton(
                    onClick = { viewModel.trySendAction(SendAction.AddSendClick) },
                    painter = rememberVectorPainter(id = VowkeyDrawable.ic_plus_large),
                    contentDescription = stringResource(id = VowkeyString.add_item),
                    modifier = Modifier.testTag(tag = "AddItemButton"),
                )
            }
        },
        pullToRefreshState = pullToRefreshState,
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        val contentModifier = Modifier.fillMaxSize()
        val upgradedToPremiumCardData = UpgradedToPremiumCardData(
            onCardClick = {
                viewModel.trySendAction(SendAction.UpgradedToPremiumCardClick)
            },
            onCardDismiss = {
                viewModel.trySendAction(SendAction.UpgradedToPremiumCardDismiss)
            },
        ).takeIf { state.isUpgradedToPremiumCardEligible }
        when (val viewState = state.viewState) {
            is SendState.ViewState.Content -> SendContent(
                policyDisablesSend = state.policyDisablesSend,
                shouldShowTypesSection = state.shouldShowTypesSection,
                state = viewState,
                upgradedToPremiumCardData = upgradedToPremiumCardData,
                sendHandlers = sendHandlers,
                modifier = contentModifier,
            )

            SendState.ViewState.Empty -> SendEmpty(
                policyDisablesSend = state.policyDisablesSend,
                onAddItemClick = { viewModel.trySendAction(SendAction.AddSendClick) },
                upgradedToPremiumCardData = upgradedToPremiumCardData,
                modifier = contentModifier,
            )

            is SendState.ViewState.Error -> VowkeyErrorContent(
                message = viewState.message(),
                buttonData = VowkeyButtonData(
                    label = VowkeyString.try_again.asText(),
                    onClick = { viewModel.trySendAction(SendAction.RefreshClick) },
                ),
                modifier = contentModifier,
            )

            SendState.ViewState.Loading -> VowkeyLoadingContent(
                modifier = contentModifier,
            )
        }
    }
}

@Composable
private fun SendDialogs(
    dialogState: SendState.DialogState?,
    onAddSendSelected: (SendItemType) -> Unit,
    onUpgradeToPremiumClick: () -> Unit,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is SendState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
            throwable = dialogState.throwable,
        )

        is SendState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        SendState.DialogState.SelectSendAddType -> VowkeySelectionDialog(
            title = stringResource(id = VowkeyString.type),
            onDismissRequest = onDismissRequest,
        ) {
            SendItemType.entries.forEach {
                VowkeyBasicDialogRow(
                    text = it.selectionText(),
                    onClick = { onAddSendSelected(it) },
                )
            }
        }

        SendState.DialogState.FileTypeRequiresPremium -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.premium_subscription_required),
                message = stringResource(id = VowkeyString.send_file_premium_required),
                confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = onUpgradeToPremiumClick,
                onDismissClick = onDismissRequest,
                onDismissRequest = onDismissRequest,
            )
        }

        null -> Unit
    }
}

/**
 * Action card rendered at the top of the Send list when the user has just upgraded to premium.
 * Owned by the screen so it can be hosted inside each view state's scrollable container.
 */
@Composable
internal fun UpgradedToPremiumActionCard(
    onActionClick: () -> Unit,
    onDismissClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    VowkeyActionCard(
        cardTitle = stringResource(id = VowkeyString.upgraded_to_premium),
        cardSubtitle = stringResource(
            id = VowkeyString.you_now_have_access_to_all_advanced_security_features,
        ),
        actionButton = VowkeyButtonData(
            label = VowkeyString.learn_more.asText(),
            onClick = onActionClick,
            isExternalLink = true,
        ),
        leadingContent = {
            Icon(
                painter = rememberVectorPainter(id = VowkeyDrawable.ic_star),
                contentDescription = null,
                tint = VowkeyTheme.colorScheme.icon.secondary,
            )
        },
        onDismissClick = onDismissClick,
        modifier = modifier,
    )
}
