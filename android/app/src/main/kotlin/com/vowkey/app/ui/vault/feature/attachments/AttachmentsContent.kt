package com.vowkey.app.ui.vault.feature.attachments

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.util.nonEditableExtensionVisualTransformation
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.attachments.handlers.AttachmentsHandlers

/**
 * The top level content UI state for the [AttachmentsScreen] when viewing a content.
 */
@Composable
fun AttachmentsContent(
    viewState: AttachmentsState.ViewState.Content,
    attachmentsHandlers: AttachmentsHandlers,
    isAttachmentUpdatesEnabled: Boolean,
    modifier: Modifier = Modifier,
) {
    if (isAttachmentUpdatesEnabled) {
        AttachmentsContentV2(
            viewState = viewState,
            attachmentsHandlers = attachmentsHandlers,
            modifier = modifier,
        )
    } else {
        AttachmentsContentV1(
            viewState = viewState,
            attachmentsHandlers = attachmentsHandlers,
            modifier = modifier,
        )
    }
}

/**
 * The top level content UI state for the [AttachmentsScreen] when viewing a content.
 */
@Suppress("LongMethod")
@Composable
private fun AttachmentsContentV1(
    viewState: AttachmentsState.ViewState.Content,
    attachmentsHandlers: AttachmentsHandlers,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        if (viewState.attachments.isEmpty()) {
            item {
                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = stringResource(id = VowkeyString.no_attachments),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.text.primary,
                    textAlign = TextAlign.Center,
                    modifier = Modifier
                        .testTag("NoAttachmentsLabel")
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
                Spacer(modifier = Modifier.height(8.dp))
            }
        } else {
            item {
                Spacer(modifier = Modifier.height(height = 12.dp))
            }
            itemsIndexed(viewState.attachments) { index, it ->
                AttachmentListEntry(
                    attachmentItem = it,
                    onDeleteClick = attachmentsHandlers.onDeleteClick,
                    onItemClick = attachmentsHandlers.onItemClick,
                    cardStyle = viewState.attachments.toListItemCardStyle(index = index),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .testTag("AttachmentList"),
                )
            }
        }

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.add_new_attachment),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        item {
            Text(
                text = viewState
                    .newAttachment
                    ?.completeFileName
                    ?: stringResource(id = VowkeyString.no_file_chosen),
                color = VowkeyTheme.colorScheme.text.secondary,
                style = VowkeyTheme.typography.bodySmall,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("SelectedFileNameLabel"),
            )
        }

        item {
            Spacer(modifier = Modifier.height(8.dp))
            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.choose_file),
                onClick = attachmentsHandlers.onChooseFileClick,
                isExternalLink = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("AttachmentSelectFileButton"),
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(id = VowkeyString.max_file_size),
                color = VowkeyTheme.colorScheme.text.secondary,
                style = VowkeyTheme.typography.bodySmall,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 12.dp),
            )
        }

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

/**
 * The top level content UI state for the [AttachmentsScreen] when viewing a content.
 */
@Suppress("LongMethod")
@Composable
private fun AttachmentsContentV2(
    viewState: AttachmentsState.ViewState.Content,
    attachmentsHandlers: AttachmentsHandlers,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        item {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.attachments),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        if (viewState.attachments.isEmpty()) {
            item {
                Box(
                    contentAlignment = Alignment.CenterStart,
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .defaultMinSize(minHeight = 60.dp)
                        .cardStyle(cardStyle = CardStyle.Full),
                ) {
                    Text(
                        text = stringResource(id = VowkeyString.no_attachments),
                        style = VowkeyTheme.typography.bodyLarge,
                        color = VowkeyTheme.colorScheme.text.secondary,
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp)
                            .testTag(tag = "NoAttachmentsLabel"),
                    )
                }
            }
        } else {
            itemsIndexed(items = viewState.attachments) { index, attachment ->
                AttachmentListEntry(
                    attachmentItem = attachment,
                    onDeleteClick = attachmentsHandlers.onDeleteClick,
                    onItemClick = attachmentsHandlers.onItemClick,
                    cardStyle = viewState.attachments.toListItemCardStyle(index = index),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .testTag(tag = "AttachmentList"),
                )
            }
        }

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            VowkeyListHeaderText(
                label = stringResource(id = VowkeyString.add_new_attachment),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        item {
            VowkeyTextField(
                label = stringResource(id = VowkeyString.file_name),
                value = viewState.newAttachment?.displayName
                    ?: stringResource(id = VowkeyString.no_file_chosen),
                textFieldTestTag = "SelectedFileNameLabel",
                onValueChange = attachmentsHandlers.onFileNameChange,
                enabled = viewState.newAttachment != null,
                supportingText = stringResource(id = VowkeyString.max_file_size),
                visualTransformation = nonEditableExtensionVisualTransformation(
                    fileExtension = viewState.newAttachment?.extension,
                ),
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }

        item {
            Spacer(modifier = Modifier.height(height = 8.dp))
            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.choose_file),
                onClick = attachmentsHandlers.onChooseFileClick,
                isExternalLink = true,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag(tag = "AttachmentSelectFileButton"),
            )
        }

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun AttachmentListEntry(
    attachmentItem: AttachmentsState.AttachmentItem,
    onDeleteClick: (attachmentId: String) -> Unit,
    onItemClick: (attachment: AttachmentsState.AttachmentItem) -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    var shouldShowDeleteDialog by rememberSaveable { mutableStateOf(false) }
    if (shouldShowDeleteDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.delete),
            message = stringResource(id = VowkeyString.do_you_really_want_to_delete),
            confirmButtonText = stringResource(id = VowkeyString.delete),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowDeleteDialog = false
                onDeleteClick(attachmentItem.id)
            },
            onDismissClick = { shouldShowDeleteDialog = false },
            onDismissRequest = { shouldShowDeleteDialog = false },
        )
    }

    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 60.dp)
            .cardStyle(
                cardStyle = cardStyle,
                padding = PaddingValues(start = 16.dp),
                onClick = { onItemClick(attachmentItem) },
            )
            .testTag("AttachmentRow"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = attachmentItem.title,
            color = VowkeyTheme.colorScheme.text.primary,
            style = VowkeyTheme.typography.bodyLarge,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier
                .weight(1f)
                .testTag("AttachmentNameLabel"),
        )

        Spacer(modifier = Modifier.width(16.dp))

        Text(
            text = attachmentItem.displaySize,
            color = VowkeyTheme.colorScheme.text.secondary,
            style = VowkeyTheme.typography.bodyMedium,
            modifier = Modifier
                .testTag("AttachmentSizeLabel"),
        )

        Spacer(modifier = Modifier.width(8.dp))

        VowkeyStandardIconButton(
            vectorIconRes = VowkeyDrawable.ic_trash,
            contentDescription = stringResource(id = VowkeyString.delete),
            onClick = { shouldShowDeleteDialog = true },
            modifier = Modifier
                .testTag("AttachmentDeleteButton"),
        )
    }
}
