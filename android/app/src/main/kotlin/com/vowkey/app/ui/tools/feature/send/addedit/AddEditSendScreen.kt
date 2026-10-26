package com.vowkey.app.ui.tools.feature.send.addedit

import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.core.util.persistentListOfNotNull
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.appbar.model.TopAppBarDividerStyle
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalExitManager
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.exit.ExitManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.platform.composition.LocalPermissionsManager
import com.vowkey.app.ui.platform.manager.permissions.PermissionsManager
import com.vowkey.app.ui.tools.feature.generator.model.GeneratorMode
import com.vowkey.app.ui.tools.feature.send.addedit.handlers.AddEditSendHandlers

/**
 * Displays new send UX.
 */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddEditSendScreen(
    viewModel: AddEditSendViewModel = hiltViewModel(),
    exitManager: ExitManager = LocalExitManager.current,
    intentManager: IntentManager = LocalIntentManager.current,
    permissionsManager: PermissionsManager = LocalPermissionsManager.current,
    onNavigateBack: () -> Unit,
    onNavigateUpToSearchOrRoot: () -> Unit,
    onNavigateToGeneratorModal: (GeneratorMode.Modal) -> Unit,
    onNavigateToPlan: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val addSendHandlers = remember(viewModel) { AddEditSendHandlers.create(viewModel) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    val fileChooserLauncher = intentManager.getActivityResultLauncher { activityResult ->
        intentManager.getFileDataFromActivityResult(activityResult)?.let {
            addSendHandlers.onFileChoose(it)
        }
    }

    val snackbarHostState = rememberVowkeySnackbarHostState()
    BackHandler(
        onBack = { viewModel.trySendAction(AddEditSendAction.CloseClick) },
    )
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            AddEditSendEvent.ExitApp -> exitManager.exitApplication()

            is AddEditSendEvent.NavigateBack -> onNavigateBack()

            is AddEditSendEvent.NavigateUpToSearchOrRoot -> onNavigateUpToSearchOrRoot()

            is AddEditSendEvent.ShowChooserSheet -> {
                fileChooserLauncher.launch(
                    intentManager.createFileChooserIntent(event.withCameraOption),
                )
            }

            is AddEditSendEvent.ShowShareSheet -> {
                intentManager.shareText(event.message)
            }

            is AddEditSendEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)

            is AddEditSendEvent.NavigateToGeneratorModal -> {
                onNavigateToGeneratorModal(event.generatorMode)
            }

            is AddEditSendEvent.NavigateToPremium -> {
                intentManager.launchUri(uri = event.uri.toUri())
            }

            AddEditSendEvent.NavigateToPlanModal -> onNavigateToPlan()
        }
    }

    AddEditSendDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(AddEditSendAction.DismissDialogClick) },
        onUpgradeToPremiumClick = {
            viewModel.trySendAction(AddEditSendAction.UpgradeToPremiumClick)
        },
    )
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = state.screenDisplayName(),
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                    navigationIconContentDescription = stringResource(id = VowkeyString.close),
                    onNavigationIconClick = {
                        viewModel.trySendAction(AddEditSendAction.CloseClick)
                    },
                )
                    .takeUnless { state.isShared },
                dividerStyle = TopAppBarDividerStyle.NONE,
                scrollBehavior = scrollBehavior,
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        isEnabled = !state.policyDisablesSend,
                        onClick = { viewModel.trySendAction(AddEditSendAction.SaveClick) },
                        modifier = Modifier.testTag("SaveButton"),
                    )
                    VowkeyOverflowActionItem(
                        isVisible = !state.isNewSend,
                        menuItemDataList = persistentListOfNotNull(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.remove_password),
                                onClick = {
                                    viewModel.trySendAction(AddEditSendAction.RemovePasswordClick)
                                },
                            )
                                .takeIf { state.hasPassword && !state.policyDisablesSend },
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.copy_link),
                                onClick = {
                                    viewModel.trySendAction(AddEditSendAction.CopyLinkClick)
                                },
                            )
                                .takeIf { !state.policyDisablesSend },
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.share_link),
                                isExternalLink = true,
                                onClick = {
                                    viewModel.trySendAction(AddEditSendAction.ShareLinkClick)
                                },
                            )
                                .takeIf { !state.policyDisablesSend },
                        ),
                    )
                },
            )
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        val modifier = Modifier
            .fillMaxSize()

        when (val viewState = state.viewState) {
            is AddEditSendState.ViewState.Content -> AddEditSendContent(
                state = viewState,
                enforcedDeletionHours = state.enforcedDeletionHours,
                enforcedWhoCanAccess = state.enforcedWhoCanAccess,
                policyDisablesSend = state.policyDisablesSend,
                policySendOptionsInEffect = state.shouldDisplayPolicyWarning,
                shouldHideEmailAddressToggle = state.shouldHideEmailAddressToggle,
                isNewSend = state.isNewSend,
                isShared = state.isShared,
                addSendHandlers = addSendHandlers,
                permissionsManager = permissionsManager,
                modifier = modifier,
            )

            is AddEditSendState.ViewState.Error -> VowkeyErrorContent(
                message = viewState.message(),
                modifier = modifier,
            )

            AddEditSendState.ViewState.Loading -> VowkeyLoadingContent(
                modifier = modifier,
            )
        }
    }
}

@Composable
private fun AddEditSendDialogs(
    dialogState: AddEditSendState.DialogState?,
    onDismissRequest: () -> Unit,
    onUpgradeToPremiumClick: () -> Unit,
) {
    when (dialogState) {
        is AddEditSendState.DialogState.PremiumRequired -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.premium_subscription_required),
                message = dialogState.message(),
                confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = onUpgradeToPremiumClick,
                onDismissClick = onDismissRequest,
                onDismissRequest = onDismissRequest,
            )
        }

        is AddEditSendState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
            throwable = dialogState.throwable,
        )

        is AddEditSendState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        null -> Unit
    }
}
