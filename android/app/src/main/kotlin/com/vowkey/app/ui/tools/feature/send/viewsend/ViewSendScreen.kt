package com.vowkey.app.ui.tools.feature.send.viewsend

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedErrorButton
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.fab.VowkeyFloatingActionButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyExpandingHeader
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.icon.VowkeyIcon
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.stepper.VowkeyStepper
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.tools.feature.send.addedit.AddEditSendRoute
import com.vowkey.app.ui.tools.feature.send.addedit.ModeType
import com.vowkey.app.ui.tools.feature.send.viewsend.model.SendPolicyRestriction

/**
 * Displays view send screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewSendScreen(
    viewModel: ViewSendViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit,
    onNavigateToAddEditSend: (route: AddEditSendRoute) -> Unit,
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val resources = LocalResources.current
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is ViewSendEvent.NavigateBack -> onNavigateBack()
            is ViewSendEvent.NavigateToCopy -> {
                onNavigateToAddEditSend(
                    AddEditSendRoute(
                        sendType = event.sendType,
                        modeType = ModeType.COPY,
                        sendId = event.sendId,
                    ),
                )
            }

            is ViewSendEvent.NavigateToEdit -> {
                onNavigateToAddEditSend(
                    AddEditSendRoute(
                        sendType = event.sendType,
                        modeType = ModeType.EDIT,
                        sendId = event.sendId,
                    ),
                )
            }

            is ViewSendEvent.ShareText -> {
                intentManager.shareText(text = event.text(resources).toString())
            }

            is ViewSendEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    ViewSendDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(ViewSendAction.DialogDismiss) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
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
                    onNavigationIconClick = { viewModel.trySendAction(ViewSendAction.CloseClick) },
                ),
                scrollBehavior = scrollBehavior,
            )
        },
        floatingActionButton = {
            AnimatedVisibility(
                visible = state.isFabVisible,
                enter = scaleIn(),
                exit = scaleOut(),
            ) {
                VowkeyFloatingActionButton(
                    onClick = { viewModel.trySendAction(ViewSendAction.EditClick) },
                    painter = rememberVectorPainter(id = VowkeyDrawable.ic_pencil),
                    contentDescription = stringResource(id = VowkeyString.edit_send),
                    modifier = Modifier.testTag(tag = "EditItemButton"),
                )
            }
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        ViewSendScreenContent(
            state = state,
            modifier = Modifier.fillMaxSize(),
            onCopyClick = { viewModel.trySendAction(ViewSendAction.CopyClick) },
            onCopyNotesClick = { viewModel.trySendAction(ViewSendAction.CopyNotesClick) },
            onDeleteClick = { viewModel.trySendAction(ViewSendAction.DeleteClick) },
            onMakeACopyClick = { viewModel.trySendAction(ViewSendAction.MakeACopyClick) },
            onShareClick = { viewModel.trySendAction(ViewSendAction.ShareClick) },
        )
    }
}

@Composable
private fun ViewSendDialogs(
    dialogState: ViewSendState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is ViewSendState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                throwable = dialogState.throwable,
                onDismissRequest = onDismissRequest,
            )
        }

        is ViewSendState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        null -> Unit
    }
}

@Composable
private fun ViewSendScreenContent(
    state: ViewSendState,
    onCopyClick: () -> Unit,
    onCopyNotesClick: () -> Unit,
    onDeleteClick: () -> Unit,
    onMakeACopyClick: () -> Unit,
    onShareClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (val viewState = state.viewState) {
        is ViewSendState.ViewState.Content -> {
            ViewStateContent(
                state = viewState,
                policyRestriction = state.policyRestriction,
                isSendDisabled = state.isSendDisabled,
                onCopyClick = onCopyClick,
                onCopyNotesClick = onCopyNotesClick,
                onDeleteClick = onDeleteClick,
                onMakeACopyClick = onMakeACopyClick,
                onShareClick = onShareClick,
                modifier = modifier,
            )
        }

        is ViewSendState.ViewState.Error -> {
            VowkeyErrorContent(
                message = viewState.message(),
                modifier = modifier,
            )
        }

        ViewSendState.ViewState.Loading -> {
            VowkeyLoadingContent(modifier = modifier)
        }
    }
}

@Suppress("LongMethod")
@Composable
private fun ViewStateContent(
    state: ViewSendState.ViewState.Content,
    policyRestriction: SendPolicyRestriction?,
    isSendDisabled: Boolean,
    onCopyClick: () -> Unit,
    onCopyNotesClick: () -> Unit,
    onDeleteClick: () -> Unit,
    onMakeACopyClick: () -> Unit,
    onShareClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.verticalScroll(state = rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        policyRestriction?.let {
            VowkeyActionCard(
                cardTitle = stringResource(id = VowkeyString.organization_policy_restriction),
                cardSubtitle = it.message(),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.make_a_copy.asText(),
                    onClick = onMakeACopyClick,
                    testTag = "SendMakeACopyButton",
                )
                    .takeIf { _ -> it.isCopyable },
                leadingContent = {
                    VowkeyIcon(
                        iconData = IconData.Local(iconRes = VowkeyDrawable.ic_info_circle),
                        tint = VowkeyTheme.colorScheme.icon.secondary,
                    )
                },
                modifier = Modifier
                    .testTag(tag = "SendPolicyRestrictionBanner")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
        }
        if (!isSendDisabled) {
            ShareLinkSection(
                shareLink = state.shareLink,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
            VowkeyFilledButton(
                label = stringResource(id = VowkeyString.copy),
                onClick = onCopyClick,
                icon = rememberVectorPainter(id = VowkeyDrawable.ic_copy_small),
                cardStyle = CardStyle.Middle(hasDivider = false),
                cardInsets = PaddingValues(top = 16.dp, bottom = 6.dp, start = 16.dp, end = 16.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag(tag = "ViewSendCopyButton"),
            )
            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.share),
                onClick = onShareClick,
                icon = rememberVectorPainter(id = VowkeyDrawable.ic_share_small),
                isExternalLink = true,
                cardStyle = CardStyle.Bottom,
                cardInsets = PaddingValues(top = 6.dp, bottom = 16.dp, start = 16.dp, end = 16.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag(tag = "ViewSendShareButton"),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
        }

        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.send_details),
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyTextField(
            label = stringResource(id = VowkeyString.send_name_required),
            value = state.sendName,
            onValueChange = {},
            readOnly = true,
            cardStyle = CardStyle.Full,
            textFieldTestTag = "ViewSendNameField",
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        when (val sendType = state.sendType) {
            is ViewSendState.ViewState.Content.SendType.FileType -> {
                FileSendContent(
                    fileType = sendType,
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }

            is ViewSendState.ViewState.Content.SendType.TextType -> {
                TextSendContent(
                    textType = sendType,
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }
        }
        Spacer(modifier = Modifier.height(height = 8.dp))

        VowkeyTextField(
            label = stringResource(id = VowkeyString.deletion_date),
            value = state.deletionDate,
            onValueChange = {},
            readOnly = true,
            cardStyle = CardStyle.Full,
            textFieldTestTag = "ViewSendDeletionDateField",
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        AdditionalOptions(
            state = state,
            onCopyNotesClick = onCopyNotesClick,
        )

        DeleteButton(
            onDeleteClick = onDeleteClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .testTag("ViewSendDeleteButton"),
        )
        Spacer(modifier = Modifier.height(height = 88.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun DeleteButton(
    onDeleteClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var shouldShowDeleteConfirmationDialog by rememberSaveable { mutableStateOf(value = false) }
    if (shouldShowDeleteConfirmationDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.delete),
            message = stringResource(id = VowkeyString.are_you_sure_delete_send),
            confirmButtonText = stringResource(id = VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                onDeleteClick()
                shouldShowDeleteConfirmationDialog = false
            },
            onDismissClick = { shouldShowDeleteConfirmationDialog = false },
            onDismissRequest = { shouldShowDeleteConfirmationDialog = false },
        )
    }
    VowkeyOutlinedErrorButton(
        label = stringResource(id = VowkeyString.delete_send),
        onClick = { shouldShowDeleteConfirmationDialog = true },
        icon = rememberVectorPainter(id = VowkeyDrawable.ic_trash_small),
        modifier = modifier,
    )
}

/**
 * A default content block which displays a header with an optional subtitle and an icon.
 * Implemented to match design component.
 */
@Composable
private fun ShareLinkSection(
    shareLink: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .cardStyle(
                cardStyle = CardStyle.Top(dividerPadding = 0.dp),
                paddingHorizontal = 16.dp,
                paddingVertical = 12.dp,
            ),
    ) {
        Text(
            text = stringResource(id = VowkeyString.send_link),
            style = VowkeyTheme.typography.titleSmall,
            color = VowkeyTheme.colorScheme.text.primary,
            overflow = TextOverflow.Ellipsis,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(height = 4.dp))
        Text(
            text = shareLink,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.secondary,
            overflow = TextOverflow.Ellipsis,
            maxLines = 1,
            modifier = Modifier
                .fillMaxWidth()
                .testTag(tag = "ViewSendShareLinkText"),
        )
    }
}

@Composable
private fun FileSendContent(
    fileType: ViewSendState.ViewState.Content.SendType.FileType,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 60.dp)
            .cardStyle(
                cardStyle = CardStyle.Full,
                paddingHorizontal = 16.dp,
                paddingVertical = 12.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = fileType.fileName,
            color = VowkeyTheme.colorScheme.text.primary,
            style = VowkeyTheme.typography.bodyLarge,
            modifier = Modifier
                .weight(weight = 1f)
                .testTag("ViewSendFileNameText"),
        )
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = fileType.fileSize,
            color = VowkeyTheme.colorScheme.text.secondary,
            style = VowkeyTheme.typography.bodyLarge,
            modifier = Modifier.testTag("ViewSendFileSizeText"),
        )
    }
}

@Composable
private fun TextSendContent(
    textType: ViewSendState.ViewState.Content.SendType.TextType,
    modifier: Modifier = Modifier,
) {
    VowkeyTextField(
        label = stringResource(id = VowkeyString.text_to_share),
        value = textType.textToShare,
        onValueChange = {},
        readOnly = true,
        cardStyle = CardStyle.Full,
        textFieldTestTag = "ViewSendContentText",
        modifier = modifier,
    )
}

@Suppress("LongMethod")
@Composable
private fun ColumnScope.AdditionalOptions(
    state: ViewSendState.ViewState.Content,
    onCopyNotesClick: () -> Unit,
) {
    if (state.maxAccessCount == null && state.notes == null) {
        Spacer(modifier = Modifier.height(height = 16.dp))
        return
    }
    var isExpanded by rememberSaveable { mutableStateOf(value = false) }
    VowkeyExpandingHeader(
        isExpanded = isExpanded,
        onClick = { isExpanded = !isExpanded },
        modifier = Modifier
            .testTag(tag = "ViewSendAdditionalOptions")
            .standardHorizontalMargin()
            .fillMaxWidth(),
    )
    // Hide all content if not expanded:
    AnimatedVisibility(
        visible = isExpanded,
        enter = fadeIn() + expandVertically(expandFrom = Alignment.Top),
        exit = fadeOut() + shrinkVertically(shrinkTowards = Alignment.Top),
        modifier = Modifier.clipToBounds(),
    ) {
        Column {
            state.maxAccessCount?.let {
                VowkeyStepper(
                    label = stringResource(id = VowkeyString.maximum_access_count),
                    value = it,
                    supportingText = VowkeyString.current_access_count
                        .asText(state.currentAccessCount)
                        .invoke(),
                    onValueChange = {},
                    isDecrementEnabled = false,
                    isIncrementEnabled = false,
                    range = 0..Int.MAX_VALUE,
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .testTag(tag = "ViewSendMaxAccessCount")
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }
            state.notes?.let {
                if (state.maxAccessCount != null) {
                    // If the stepper is present, we need a spacer between these 2 items
                    Spacer(modifier = Modifier.height(height = 8.dp))
                }
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.private_notes),
                    readOnly = true,
                    value = it,
                    actions = {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_copy,
                            contentDescription = stringResource(id = VowkeyString.copy_notes),
                            onClick = onCopyNotesClick,
                            modifier = Modifier.testTag(tag = "ViewSendNotesCopyButton"),
                        )
                    },
                    singleLine = false,
                    onValueChange = {},
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .testTag(tag = "ViewSendNotes")
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
            }
            Spacer(modifier = Modifier.height(height = 16.dp))
        }
    }
}
