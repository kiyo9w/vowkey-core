package com.vowkey.app.ui.platform.feature.settings.autofill.blockautofill

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredHeightIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.util.maxDialogHeight
import com.vowkey.ui.platform.components.divider.VowkeyHorizontalDivider
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * A dialog for adding a blocked URI.
 */
@Suppress("LongMethod")
@Composable
fun AddEditBlockedUriDialog(
    uri: String,
    isEdit: Boolean,
    errorMessage: String?,
    onUriChange: (String) -> Unit,
    onCancelClick: () -> Unit,
    onSaveClick: (String) -> Unit,
    onDismissRequest: () -> Unit,
) {
    Dialog(
        onDismissRequest = onDismissRequest,
    ) {
        val configuration = LocalConfiguration.current
        val scrollState = rememberScrollState()
        Column(
            modifier = Modifier
                .semantics { testTagsAsResourceId = true }
                .requiredHeightIn(
                    max = configuration.maxDialogHeight,
                )
                // This background is necessary for the dialog to not be transparent.
                .background(
                    color = VowkeyTheme.colorScheme.background.primary,
                    shape = VowkeyTheme.shapes.dialog,
                ),
            horizontalAlignment = Alignment.End,
        ) {
            Text(
                modifier = Modifier
                    .padding(top = 24.dp, start = 24.dp, end = 24.dp)
                    .fillMaxWidth(),
                text = stringResource(
                    id = if (isEdit) {
                        VowkeyString.edit_blocked_uri
                    } else {
                        VowkeyString.new_blocked_uri
                    },
                ),
                color = VowkeyTheme.colorScheme.text.primary,
                style = VowkeyTheme.typography.headlineSmall,
            )
            if (scrollState.canScrollBackward) {
                VowkeyHorizontalDivider()
            }

            Spacer(modifier = Modifier.height(8.dp))

            Column(
                modifier = Modifier
                    .weight(1f, fill = false)
                    .verticalScroll(scrollState),
            ) {
                VowkeyTextField(
                    label = stringResource(id = VowkeyString.enter_uri),
                    isError = errorMessage != null,
                    supportingText = errorMessage ?: stringResource(
                        id = VowkeyString.format_x_separate_multiple_ur_is_with_a_comma,
                        "http://domain.com",
                    ),
                    value = uri,
                    onValueChange = onUriChange,
                    keyboardType = KeyboardType.Uri,
                    cardStyle = CardStyle.Full,
                    textFieldTestTag = "BlockedUriEntry",
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            if (scrollState.canScrollForward) {
                VowkeyHorizontalDivider()
            }
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.padding(start = 8.dp, top = 24.dp, bottom = 24.dp, end = 24.dp),
            ) {
                VowkeyTextButton(
                    label = stringResource(id = VowkeyString.cancel),
                    onClick = onCancelClick,
                )

                VowkeyFilledButton(
                    label = stringResource(id = VowkeyString.save),
                    onClick = { onSaveClick(uri) },
                    modifier = Modifier.testTag(tag = "BlockedUriSaveButton"),
                )
            }
        }
    }
}
