package com.vowkey.app.ui.vault.feature.item.component

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.annotatedStringResource
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.spanStyleOf
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.item.VaultItemState

/**
 * Attachment UI common for all item types.
 */
@Suppress("LongMethod")
@Composable
fun VaultItemAttachment(
    attachmentItem: VaultItemState.ViewState.Content.Common.AttachmentItem,
    onAttachmentDownloadClick: (VaultItemState.ViewState.Content.Common.AttachmentItem) -> Unit,
    onAttachmentPreviewClick: (VaultItemState.ViewState.Content.Common.AttachmentItem) -> Unit,
    onUpgradeToPremiumClick: () -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    var shouldShowPremiumWarningDialog by rememberSaveable { mutableStateOf(false) }
    var shouldShowSizeWarningDialog by rememberSaveable { mutableStateOf(false) }

    Box(
        contentAlignment = Alignment.CenterStart,
        modifier = modifier
            .defaultMinSize(minHeight = 60.dp)
            .cardStyle(
                cardStyle = cardStyle,
                padding = PaddingValues(start = 16.dp),
                onClick = {
                    if (!attachmentItem.isDownloadAllowed) {
                        shouldShowPremiumWarningDialog = true
                        return@cardStyle
                    }
                    onAttachmentPreviewClick(attachmentItem)
                },
            )
            .testTag("CipherAttachment"),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
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

            Row(
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = attachmentItem.displaySize,
                    color = VowkeyTheme.colorScheme.text.secondary,
                    style = VowkeyTheme.typography.bodyMedium,
                    modifier = Modifier
                        .testTag("AttachmentSizeLabel"),
                )

                Spacer(modifier = Modifier.width(8.dp))

                VowkeyStandardIconButton(
                    vectorIconRes = VowkeyDrawable.ic_download,
                    contentDescription = stringResource(id = VowkeyString.download),
                    isExternalLink = true,
                    onClick = {
                        if (!attachmentItem.isDownloadAllowed) {
                            shouldShowPremiumWarningDialog = true
                            return@VowkeyStandardIconButton
                        }

                        if (attachmentItem.isLargeFile) {
                            shouldShowSizeWarningDialog = true
                            return@VowkeyStandardIconButton
                        }

                        onAttachmentDownloadClick(attachmentItem)
                    },
                    modifier = Modifier
                        .testTag("AttachmentDownloadButton"),
                )
            }
        }
    }

    if (shouldShowPremiumWarningDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.premium_subscription_required),
            message = stringResource(id = VowkeyString.attachments_are_a_premium_feature),
            confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowPremiumWarningDialog = false
                onUpgradeToPremiumClick()
            },
            onDismissClick = { shouldShowPremiumWarningDialog = false },
            onDismissRequest = { shouldShowPremiumWarningDialog = false },
        )
    }

    if (shouldShowSizeWarningDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.download_attachment),
            message = annotatedStringResource(
                id = VowkeyString.attachment_large_warning,
                args = arrayOf(attachmentItem.displaySize),
                style = spanStyleOf(
                    color = VowkeyTheme.colorScheme.text.primary,
                    textStyle = VowkeyTheme.typography.bodyMedium,
                ),
            ),
            confirmButtonText = stringResource(VowkeyString.yes),
            dismissButtonText = stringResource(VowkeyString.no),
            onConfirmClick = {
                shouldShowSizeWarningDialog = false
                onAttachmentDownloadClick(attachmentItem)
            },
            onDismissClick = { shouldShowSizeWarningDialog = false },
            onDismissRequest = { shouldShowSizeWarningDialog = false },
        )
    }
}
