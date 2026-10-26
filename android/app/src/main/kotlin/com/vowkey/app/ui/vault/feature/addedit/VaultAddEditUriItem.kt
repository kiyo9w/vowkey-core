package com.vowkey.app.ui.vault.feature.addedit

import android.content.res.Resources
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import com.vowkey.core.util.persistentListOfNotNull
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.dialog.VowkeySelectionDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dialog.row.VowkeyBasicDialogRow
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectDialogContent
import com.vowkey.ui.platform.components.dropdown.model.MultiSelectOption
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.data.platform.repository.model.UriMatchType
import com.vowkey.app.ui.platform.feature.settings.autofill.util.displayLabel
import com.vowkey.app.ui.vault.feature.addedit.model.UriItem
import com.vowkey.app.ui.vault.feature.addedit.model.UriMatchDisplayType
import com.vowkey.app.ui.vault.feature.addedit.util.displayLabel
import com.vowkey.app.ui.vault.feature.addedit.util.isAdvancedMatching
import com.vowkey.app.ui.vault.feature.addedit.util.toDisplayMatchType
import com.vowkey.app.ui.vault.feature.addedit.util.toUriMatchType
import kotlinx.collections.immutable.ImmutableList

/**
 * The URI item displayed to the user.
 */
@Suppress("LongMethod")
@Composable
fun VaultAddEditUriItem(
    uriItem: UriItem,
    onUriItemRemoved: (UriItem) -> Unit,
    onUriValueChange: (UriItem) -> Unit,
    cardStyle: CardStyle,
    defaultUriMatchType: UriMatchType,
    onLearnMoreClick: () -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    var shouldShowOptionsDialog by rememberSaveable { mutableStateOf(false) }
    var shouldShowMatchDialog by rememberSaveable { mutableStateOf(false) }
    var shouldShowAdvancedMatchDialog by rememberSaveable { mutableStateOf(false) }
    var optionPendingConfirmation by rememberSaveable { mutableStateOf<UriMatchDisplayType?>(null) }
    var shouldShowLearnMoreMatchDetectionDialog by rememberSaveable { mutableStateOf(false) }
    val defaultUriOption = remember(defaultUriMatchType) {
        defaultUriMatchType.displayLabel.toString(resources)
    }

    VowkeyTextField(
        label = stringResource(id = VowkeyString.website_uri),
        value = uriItem.uri.orEmpty(),
        onValueChange = { onUriValueChange(uriItem.copy(uri = it)) },
        singleLine = false,
        keyboardType = KeyboardType.Uri,
        actions = {
            VowkeyStandardIconButton(
                vectorIconRes = VowkeyDrawable.ic_cog,
                contentDescription = stringResource(id = VowkeyString.more_options),
                onClick = { shouldShowOptionsDialog = true },
                modifier = Modifier.testTag(tag = "LoginUriOptionsButton"),
            )
        },
        textFieldTestTag = "LoginUriEntry",
        cardStyle = cardStyle,
        modifier = modifier,
    )

    if (shouldShowOptionsDialog) {
        VowkeySelectionDialog(
            title = stringResource(id = VowkeyString.options),
            onDismissRequest = { shouldShowOptionsDialog = false },
        ) {
            VowkeyBasicDialogRow(
                text = stringResource(id = VowkeyString.match_detection),
                onClick = {
                    shouldShowOptionsDialog = false
                    shouldShowMatchDialog = true
                },
            )
            VowkeyBasicDialogRow(
                text = stringResource(id = VowkeyString.remove),
                onClick = {
                    shouldShowOptionsDialog = false
                    onUriItemRemoved(uriItem)
                },
            )
        }
    }

    if (shouldShowMatchDialog) {
        VowkeySelectionDialog(
            title = stringResource(id = VowkeyString.uri_match_detection),
            onDismissRequest = { shouldShowMatchDialog = false },
        ) {
            VowkeyMultiSelectDialogContent(
                options = uriMatchingOptions(defaultUriOption = defaultUriOption),
                selectedOption = MultiSelectOption.Row(
                    uriItem
                        .match
                        .toDisplayMatchType()
                        .displayLabel(defaultUriOption = defaultUriOption)
                        .invoke(),
                ),
                onOptionSelected = { selectedOption ->
                    shouldShowMatchDialog = false

                    val newSelectedType =
                        UriMatchDisplayType
                            .entries
                            .first {
                                it.displayLabel(defaultUriOption)
                                    .invoke(resources) == selectedOption.title
                            }

                    if (newSelectedType.isAdvancedMatching()) {
                        optionPendingConfirmation = newSelectedType
                        shouldShowAdvancedMatchDialog = true
                    } else {
                        onUriValueChange(
                            uriItem.copy(match = newSelectedType.toUriMatchType()),
                        )
                        optionPendingConfirmation = null
                    }
                },
            )
        }
    }

    val currentOptionToConfirm = optionPendingConfirmation

    if (shouldShowAdvancedMatchDialog && currentOptionToConfirm != null) {
        AdvancedMatchDetectionWarning(
            pendingOption = currentOptionToConfirm,
            defaultUriMatchType = defaultUriMatchType,
            onDialogConfirm = {
                onUriValueChange(
                    uriItem.copy(match = currentOptionToConfirm.toUriMatchType()),
                )
                shouldShowAdvancedMatchDialog = false
                optionPendingConfirmation = null
                shouldShowLearnMoreMatchDetectionDialog = true
            },
            onDialogDismiss = {
                shouldShowAdvancedMatchDialog = false
                optionPendingConfirmation = null
            },
        )
    }

    if (shouldShowLearnMoreMatchDetectionDialog) {
        LearnMoreAboutMatchDetectionDialog(
            uriMatchDisplayType = uriItem.match.toDisplayMatchType(),
            defaultUriOption = defaultUriOption,
            onDialogConfirm = {
                onLearnMoreClick()
                shouldShowLearnMoreMatchDetectionDialog = false
            },
            onDialogDismiss = {
                shouldShowLearnMoreMatchDetectionDialog = false
            },
        )
    }
}

@Composable
private fun AdvancedMatchDetectionWarning(
    pendingOption: UriMatchDisplayType,
    defaultUriMatchType: UriMatchType,
    onDialogConfirm: () -> Unit,
    onDialogDismiss: () -> Unit,
) {

    val descriptionStringResId = when (pendingOption) {
        UriMatchDisplayType.STARTS_WITH -> {
            VowkeyString.advanced_option_with_increased_risk_of_exposing_credentials
        }

        UriMatchDisplayType.REGULAR_EXPRESSION -> {
            VowkeyString.advanced_option_increased_risk_exposing_credentials_used_incorrectly
        }

        UriMatchDisplayType.DEFAULT,
        UriMatchDisplayType.HOST,
        UriMatchDisplayType.BASE_DOMAIN,
        UriMatchDisplayType.EXACT,
        UriMatchDisplayType.NEVER,
            ->
            error("Unexpected option on AdvancedMatchDetectionWarning")
    }

    val nameOfSelectedMatchDisplayType = pendingOption
        .displayLabel(defaultUriOption = defaultUriMatchType.displayLabel())
        .invoke()

    VowkeyTwoButtonDialog(
        title = stringResource(
            id = VowkeyString.are_you_sure_you_want_to_use,
            formatArgs = arrayOf(nameOfSelectedMatchDisplayType),
        ),
        message = stringResource(
            id = descriptionStringResId,
            formatArgs = arrayOf(nameOfSelectedMatchDisplayType),
        ),
        confirmButtonText = stringResource(id = VowkeyString.yes),
        dismissButtonText = stringResource(id = VowkeyString.cancel),
        onConfirmClick = onDialogConfirm,
        onDismissClick = onDialogDismiss,
        onDismissRequest = onDialogDismiss,
    )
}

@Composable
private fun LearnMoreAboutMatchDetectionDialog(
    uriMatchDisplayType: UriMatchDisplayType,
    defaultUriOption: String,
    onDialogConfirm: () -> Unit,
    onDialogDismiss: () -> Unit,
) {
    VowkeyTwoButtonDialog(
        title = stringResource(id = VowkeyString.keep_your_credential_secure),
        message = stringResource(
            id = VowkeyString.learn_more_about_how_to_keep_credentirals_secure,
            formatArgs = arrayOf(
                uriMatchDisplayType
                    .displayLabel(
                        defaultUriOption = defaultUriOption,
                    )
                    .invoke(),
            ),
        ),
        confirmButtonText = stringResource(id = VowkeyString.learn_more),
        dismissButtonText = stringResource(id = VowkeyString.close),
        onConfirmClick = onDialogConfirm,
        onDismissClick = onDialogDismiss,
        onDismissRequest = onDialogDismiss,
    )
}

@Composable
private fun uriMatchingOptions(defaultUriOption: String): ImmutableList<MultiSelectOption> {
    val advancedOptions = UriMatchDisplayType.entries.filter { it.isAdvancedMatching() }
    return persistentListOfNotNull(
        *UriMatchDisplayType
            .entries
            .filter { !it.isAdvancedMatching() }
            .map { MultiSelectOption.Row(it.displayLabel(defaultUriOption).invoke()) }
            .toTypedArray(),
        if (advancedOptions.isNotEmpty()) {
            MultiSelectOption.Header(
                title = stringResource(id = VowkeyString.advanced_options),
                testTag = "AdvancedOptionsSection",
            )
        } else {
            null
        },
        *advancedOptions
            .map { MultiSelectOption.Row(it.displayLabel(defaultUriOption).invoke()) }
            .toTypedArray(),
    )
}
