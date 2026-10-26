package com.vowkey.app.ui.vault.feature.attachments

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
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
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
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.vault.feature.attachments.handlers.AttachmentsHandlers
import com.vowkey.app.ui.vault.feature.attachments.preview.PreviewAttachmentRoute

/**
 * Displays the attachments screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AttachmentsScreen(
    viewModel: AttachmentsViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    onNavigateBack: () -> Unit,
    onNavigateToPreview: (route: PreviewAttachmentRoute) -> Unit,
    onNavigateToPlan: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val attachmentsHandlers = remember(viewModel) { AttachmentsHandlers.create(viewModel) }
    val fileChooserLauncher = intentManager.getActivityResultLauncher { activityResult ->
        intentManager.getFileDataFromActivityResult(activityResult)?.let {
            attachmentsHandlers.onFileChoose(it)
        }
    }
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            AttachmentsEvent.NavigateBack -> onNavigateBack()
            AttachmentsEvent.NavigateToPlanModal -> onNavigateToPlan()
            is AttachmentsEvent.NavigateToUri -> intentManager.launchUri(event.uri.toUri())
            AttachmentsEvent.ShowChooserSheet -> {
                fileChooserLauncher.launch(
                    intentManager.createFileChooserIntent(withCameraIntents = false),
                )
            }

            is AttachmentsEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            is AttachmentsEvent.NavigateToPreview -> {
                onNavigateToPreview(
                    PreviewAttachmentRoute(
                        cipherId = event.cipherId,
                        attachmentId = event.attachmentId,
                        fileName = event.fileName,
                        displaySize = event.displaySize,
                        isLargeFile = event.isLargeFile,
                    ),
                )
            }
        }
    }

    AttachmentsDialogs(
        dialogState = state.dialogState,
        attachmentsHandlers = attachmentsHandlers,
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .nestedScroll(scrollBehavior.nestedScrollConnection)
            .fillMaxSize(),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.attachments),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = attachmentsHandlers.onBackClick,
                ),
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        onClick = attachmentsHandlers.onSaveClick,
                        modifier = Modifier.testTag("SaveButton"),
                    )
                },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        when (val viewState = state.viewState) {
            is AttachmentsState.ViewState.Content -> AttachmentsContent(
                viewState = viewState,
                attachmentsHandlers = attachmentsHandlers,
                isAttachmentUpdatesEnabled = state.isAttachmentUpdatesEnabled,
                modifier = Modifier.fillMaxSize(),
            )

            is AttachmentsState.ViewState.Error -> VowkeyErrorContent(
                message = viewState.message(),
                modifier = Modifier.fillMaxSize(),
            )

            AttachmentsState.ViewState.Loading -> VowkeyLoadingContent(
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun AttachmentsDialogs(
    dialogState: AttachmentsState.DialogState?,
    attachmentsHandlers: AttachmentsHandlers,
) {
    when (dialogState) {
        AttachmentsState.DialogState.RequiresPremium -> VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.premium_subscription_required),
            message = stringResource(id = VowkeyString.attachments_are_a_premium_feature),
            confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
            onConfirmClick = attachmentsHandlers.onUpgradeToPremiumClick,
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onDismissClick = attachmentsHandlers.onDismissRequest,
            onDismissRequest = attachmentsHandlers.onDismissRequest,
        )

        is AttachmentsState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            onDismissRequest = attachmentsHandlers.onDismissRequest,
            throwable = dialogState.throwable,
        )

        is AttachmentsState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        null -> Unit
    }
}
