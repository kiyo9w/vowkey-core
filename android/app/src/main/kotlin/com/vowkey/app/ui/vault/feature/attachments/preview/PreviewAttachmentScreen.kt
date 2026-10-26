package com.vowkey.app.ui.vault.feature.attachments.preview

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.annotatedStringResource
import com.vowkey.ui.platform.base.util.spanStyleOf
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.preview.ImagePreviewContent
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText

/**
 * Displays the preview attachment screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PreviewAttachmentScreen(
    viewModel: PreviewAttachmentViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val fileChooserLauncher = intentManager.getActivityResultLauncher { activityResult ->
        val action = intentManager
            .getFileDataFromActivityResult(activityResult)
            ?.let { PreviewAttachmentAction.AttachmentFileLocationReceive(it.uri) }
            ?: PreviewAttachmentAction.NoAttachmentFileLocationReceive
        viewModel.trySendAction(action)
    }
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            PreviewAttachmentEvent.NavigateBack -> onNavigateBack()
            is PreviewAttachmentEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            is PreviewAttachmentEvent.NavigateToSelectAttachmentSaveLocation -> {
                fileChooserLauncher.launch(intentManager.createDocumentIntent(event.fileName))
            }
        }
    }

    PreviewAttachmentDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(PreviewAttachmentAction.DismissDialog) },
        onCloseClick = { viewModel.trySendAction(PreviewAttachmentAction.CloseClick) },
        onConfirmDownloadClick = {
            viewModel.trySendAction(PreviewAttachmentAction.ConfirmDownloadClick)
        },
    )

    VowkeyScaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            VowkeyTopAppBar(
                title = state.fileName,
                scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(),
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = {
                        viewModel.trySendAction(PreviewAttachmentAction.BackClick)
                    },
                ),
                actions = {
                    VowkeyStandardIconButton(
                        vectorIconRes = VowkeyDrawable.ic_download,
                        contentDescription = stringResource(id = VowkeyString.download),
                        onClick = {
                            viewModel.trySendAction(PreviewAttachmentAction.DownloadClick)
                        },
                        isExternalLink = true,
                        modifier = Modifier.testTag("ToolbarDownloadButton"),
                    )
                },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        when (val viewState = state.viewState) {
            is PreviewAttachmentState.ViewState.Content -> {
                ImagePreviewContent(
                    file = viewState.file,
                    onMissingFile = {
                        viewModel.trySendAction(PreviewAttachmentAction.FileMissing)
                    },
                    onLoaded = {
                        viewModel.trySendAction(PreviewAttachmentAction.BitmapRenderComplete)
                    },
                    onError = {
                        viewModel.trySendAction(PreviewAttachmentAction.BitmapRenderError)
                    },
                )
            }

            is PreviewAttachmentState.ViewState.Error -> VowkeyErrorContent(
                message = viewState.message(),
                illustrationData = IconData.Local(iconRes = viewState.illustrationRes),
                buttonData = VowkeyButtonData(
                    label = VowkeyString.download_file.asText(),
                    icon = rememberVectorPainter(id = VowkeyDrawable.ic_download),
                    onClick = { viewModel.trySendAction(PreviewAttachmentAction.DownloadClick) },
                    isExternalLink = true,
                    testTag = "ErrorStateDownloadButton",
                ),
                modifier = Modifier.fillMaxSize(),
            )

            is PreviewAttachmentState.ViewState.Loading -> VowkeyLoadingContent(
                text = viewState.message(),
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

@Composable
private fun PreviewAttachmentDialogs(
    dialogState: PreviewAttachmentState.DialogState?,
    onDismissRequest: () -> Unit,
    onCloseClick: () -> Unit,
    onConfirmDownloadClick: () -> Unit,
) {
    when (dialogState) {
        is PreviewAttachmentState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = onDismissRequest,
            )
        }

        is PreviewAttachmentState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        PreviewAttachmentState.DialogState.PreviewUnavailable -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.preview_unavailable),
                message = stringResource(
                    id = VowkeyString
                        .vowkey_could_not_decrypt_this_file_so_the_preview_cannot_be_displayed,
                ),
                confirmButtonLabel = stringResource(id = VowkeyString.close),
                onDismissRequest = onCloseClick,
            )
        }

        is PreviewAttachmentState.DialogState.DownloadLargeFileConfirmation -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.download_attachment),
                message = annotatedStringResource(
                    id = VowkeyString.attachment_large_warning,
                    args = arrayOf(dialogState.displaySize),
                    style = spanStyleOf(
                        color = VowkeyTheme.colorScheme.text.primary,
                        textStyle = VowkeyTheme.typography.bodyMedium,
                    ),
                ),
                confirmButtonText = stringResource(id = VowkeyString.yes),
                dismissButtonText = stringResource(id = VowkeyString.no),
                onConfirmClick = onConfirmDownloadClick,
                onDismissClick = onDismissRequest,
                onDismissRequest = onDismissRequest,
            )
        }

        null -> Unit
    }
}
