package com.vowkey.authenticator.ui.authenticator.feature.edititem

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FabPosition
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.authenticator.data.authenticator.datasource.disk.entity.AuthenticatorItemAlgorithm
import com.vowkey.authenticator.data.authenticator.datasource.disk.entity.AuthenticatorItemType
import com.vowkey.authenticator.ui.authenticator.feature.edititem.model.EditItemData
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.header.VowkeyExpandingHeader
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.stepper.VowkeyStepper
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyPlurals
import com.vowkey.ui.platform.resource.VowkeyString
import kotlinx.collections.immutable.toImmutableList

/**
 * Displays the edit authenticator item screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditItemScreen(
    viewModel: EditItemViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = { },
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            EditItemEvent.NavigateBack -> onNavigateBack()
        }
    }

    EditItemDialogs(
        dialogState = state.dialog,
        onDismissRequest = { viewModel.trySendAction(EditItemAction.DismissDialog) },
    )

    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.edit),
                scrollBehavior = scrollBehavior,
                navigationIcon = painterResource(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(EditItemAction.CancelClick) },
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        onClick = { viewModel.trySendAction(EditItemAction.SaveClick) },
                        modifier = Modifier.semantics { testTag = "SaveButton" },
                    )
                },
            )
        },
        floatingActionButtonPosition = FabPosition.EndOverlay,
    ) {
        when (val viewState = state.viewState) {
            is EditItemState.ViewState.Content -> {
                EditItemContent(
                    viewState = viewState,
                    onIssuerNameTextChange = {
                        viewModel.trySendAction(EditItemAction.IssuerNameTextChange(it))
                    },
                    onUsernameTextChange = {
                        viewModel.trySendAction(EditItemAction.UsernameTextChange(it))
                    },
                    onToggleFavorite = {
                        viewModel.trySendAction(EditItemAction.FavoriteToggleClick(it))
                    },
                    onTypeOptionClicked = {
                        viewModel.trySendAction(EditItemAction.TypeOptionClick(it))
                    },
                    onTotpCodeTextChange = {
                        viewModel.trySendAction(EditItemAction.TotpCodeTextChange(it))
                    },
                    onAlgorithmOptionClicked = {
                        viewModel.trySendAction(EditItemAction.AlgorithmOptionClick(it))
                    },
                    onRefreshPeriodOptionClicked = {
                        viewModel.trySendAction(EditItemAction.RefreshPeriodOptionClick(it))
                    },
                    onNumberOfDigitsChanged = {
                        viewModel.trySendAction(EditItemAction.NumberOfDigitsOptionClick(it))
                    },
                    onExpandAdvancedOptionsClicked = {
                        viewModel.trySendAction(EditItemAction.ExpandAdvancedOptionsClick)
                    },
                )
            }

            is EditItemState.ViewState.Error -> {
                VowkeyErrorContent(message = viewState.message())
            }

            EditItemState.ViewState.Loading -> {
                VowkeyLoadingContent()
            }
        }
    }
}

/**
 * The top level content UI state for the [EditItemScreen].
 */
@Suppress("LongMethod")
@Composable
fun EditItemContent(
    modifier: Modifier = Modifier,
    viewState: EditItemState.ViewState.Content,
    onIssuerNameTextChange: (String) -> Unit = {},
    onUsernameTextChange: (String) -> Unit = {},
    onToggleFavorite: (Boolean) -> Unit = {},
    onTypeOptionClicked: (AuthenticatorItemType) -> Unit = {},
    onTotpCodeTextChange: (String) -> Unit = {},
    onAlgorithmOptionClicked: (AuthenticatorItemAlgorithm) -> Unit = {},
    onRefreshPeriodOptionClicked: (AuthenticatorRefreshPeriodOption) -> Unit = {},
    onNumberOfDigitsChanged: (Int) -> Unit = {},
    onExpandAdvancedOptionsClicked: () -> Unit = {},
) {
    LazyColumn(modifier = modifier) {
        item {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeyListHeaderText(
                modifier = Modifier
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp)
                    .fillMaxWidth(),
                label = stringResource(id = VowkeyString.information),
            )
        }

        item {
            Spacer(Modifier.height(8.dp))
            VowkeyTextField(
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
                textFieldTestTag = "NameTextField",
                label = stringResource(id = VowkeyString.name),
                value = viewState.itemData.issuer,
                onValueChange = onIssuerNameTextChange,
                singleLine = true,
                cardStyle = CardStyle.Top(),
            )
        }

        item {
            VowkeyPasswordField(
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
                passwordFieldTestTag = "KeyTextField",
                label = stringResource(id = VowkeyString.key),
                value = viewState.itemData.totpCode,
                onValueChange = onTotpCodeTextChange,
                singleLine = true,
                cardStyle = CardStyle.Middle(),
            )
        }

        item {
            VowkeyTextField(
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
                textFieldTestTag = "UsernameTextField",
                label = stringResource(id = VowkeyString.username),
                value = viewState.itemData.username.orEmpty(),
                onValueChange = onUsernameTextChange,
                singleLine = true,
                cardStyle = CardStyle.Middle(),
            )
        }

        item {
            VowkeySwitch(
                label = stringResource(id = VowkeyString.favorite),
                isChecked = viewState.itemData.favorite,
                onCheckedChange = onToggleFavorite,
                cardStyle = CardStyle.Bottom,
                modifier = Modifier
                    .testTag(tag = "ItemFavoriteToggle")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }

        item(key = "AdvancedOptions") {
            VowkeyExpandingHeader(
                isExpanded = viewState.isAdvancedOptionsExpanded,
                onClick = onExpandAdvancedOptionsClicked,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("AdditionalOptionsExpandingHeader"),
            )
        }

        if (viewState.isAdvancedOptionsExpanded) {
            advancedOptions(
                viewState = viewState,
                onAlgorithmOptionClicked = onAlgorithmOptionClicked,
                onTypeOptionClicked = onTypeOptionClicked,
                onRefreshPeriodOptionClicked = onRefreshPeriodOptionClicked,
                onNumberOfDigitsChanged = onNumberOfDigitsChanged,
            )
        }

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Suppress("LongMethod")
private fun LazyListScope.advancedOptions(
    viewState: EditItemState.ViewState.Content,
    onAlgorithmOptionClicked: (AuthenticatorItemAlgorithm) -> Unit,
    onTypeOptionClicked: (AuthenticatorItemType) -> Unit,
    onRefreshPeriodOptionClicked: (AuthenticatorRefreshPeriodOption) -> Unit,
    onNumberOfDigitsChanged: (Int) -> Unit,
) {
    item(key = "OtpItemTypeSelector") {
        val possibleTypeOptions = AuthenticatorItemType.entries
        val typeOptionsWithStrings = possibleTypeOptions.associateWith { it.name }
        VowkeyMultiSelectButton(
            modifier = Modifier
                .testTag(tag = "OTPItemTypePicker")
                .standardHorizontalMargin()
                .fillMaxWidth()
                .animateItem(),
            label = stringResource(id = VowkeyString.otp_type),
            options = typeOptionsWithStrings.values.toImmutableList(),
            selectedOption = viewState.itemData.type.name,
            cardStyle = CardStyle.Top(),
            onOptionSelected = { selectedOption ->
                val selectedOptionName = typeOptionsWithStrings
                    .entries
                    .first { it.value == selectedOption }
                    .key
                onTypeOptionClicked(selectedOptionName)
            },
        )
    }

    item(key = "AlgorithmItemTypeSelector") {
        val possibleAlgorithmOptions = AuthenticatorItemAlgorithm.entries
        val algorithmOptionsWithStrings = possibleAlgorithmOptions.associateWith { it.name }
        VowkeyMultiSelectButton(
            modifier = Modifier
                .testTag(tag = "AlgorithmItemTypePicker")
                .standardHorizontalMargin()
                .fillMaxWidth()
                .animateItem(),
            label = stringResource(id = VowkeyString.algorithm),
            options = algorithmOptionsWithStrings.values.toImmutableList(),
            selectedOption = viewState.itemData.algorithm.name,
            cardStyle = CardStyle.Middle(),
            onOptionSelected = { selectedOption ->
                val selectedOptionName = algorithmOptionsWithStrings
                    .entries
                    .first { it.value == selectedOption }
                    .key
                onAlgorithmOptionClicked(selectedOptionName)
            },
        )
    }

    item(key = "RefreshPeriodItemTypePicker") {
        val possibleRefreshPeriodOptions = AuthenticatorRefreshPeriodOption.entries
        val refreshPeriodOptionsWithStrings = possibleRefreshPeriodOptions.associateWith {
            pluralStringResource(
                id = VowkeyPlurals.refresh_period_seconds,
                count = it.seconds,
                formatArgs = arrayOf(it.seconds),
            )
        }
        VowkeyMultiSelectButton(
            modifier = Modifier
                .testTag(tag = "RefreshPeriodItemTypePicker")
                .standardHorizontalMargin()
                .fillMaxWidth()
                .animateItem(),
            label = stringResource(id = VowkeyString.refresh_period),
            options = refreshPeriodOptionsWithStrings.values.toImmutableList(),
            selectedOption = refreshPeriodOptionsWithStrings.getValue(
                key = viewState.itemData.refreshPeriod,
            ),
            cardStyle = CardStyle.Middle(),
            onOptionSelected = remember(viewState) {
                { selectedOption ->
                    val selectedOptionName = refreshPeriodOptionsWithStrings
                        .entries
                        .first { it.value == selectedOption }
                        .key
                    onRefreshPeriodOptionClicked(selectedOptionName)
                }
            },
        )
    }

    item(key = "DigitsCounterItem") {
        DigitsCounterItem(
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .animateItem(),
            digits = viewState.itemData.digits,
            onDigitsCounterChange = onNumberOfDigitsChanged,
            minValue = viewState.minDigitsAllowed,
            maxValue = viewState.maxDigitsAllowed,
        )
    }
}

@Composable
private fun EditItemDialogs(
    dialogState: EditItemState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is EditItemState.DialogState.Generic -> {
            VowkeyBasicDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                onDismissRequest = onDismissRequest,
            )
        }

        is EditItemState.DialogState.Loading -> {
            VowkeyLoadingDialog(
                text = dialogState.message(),
            )
        }

        null -> Unit
    }
}

@Composable
private fun DigitsCounterItem(
    digits: Int,
    onDigitsCounterChange: (Int) -> Unit,
    minValue: Int,
    maxValue: Int,
    modifier: Modifier = Modifier,
) {
    VowkeyStepper(
        label = stringResource(id = VowkeyString.number_of_digits),
        value = digits.coerceIn(minValue, maxValue),
        range = minValue..maxValue,
        onValueChange = onDigitsCounterChange,
        cardStyle = CardStyle.Bottom,
        modifier = modifier.testTag(tag = "DigitsValueLabel"),
    )
}

@Preview(showBackground = true, showSystemUi = true)
@Composable
private fun EditItemContentExpandedOptionsPreview() {
    EditItemContent(
        viewState = EditItemState.ViewState.Content(
            isAdvancedOptionsExpanded = true,
            itemData = EditItemData(
                refreshPeriod = AuthenticatorRefreshPeriodOption.THIRTY,
                totpCode = "123456",
                type = AuthenticatorItemType.TOTP,
                username = "account name",
                issuer = "issuer",
                algorithm = AuthenticatorItemAlgorithm.SHA1,
                digits = 6,
                favorite = true,
            ),
            minDigitsAllowed = 5,
            maxDigitsAllowed = 10,
        ),
    )
}

@Preview(showBackground = true, showSystemUi = true)
@Composable
private fun EditItemContentCollapsedOptionsPreview() {
    EditItemContent(
        viewState = EditItemState.ViewState.Content(
            isAdvancedOptionsExpanded = false,
            itemData = EditItemData(
                refreshPeriod = AuthenticatorRefreshPeriodOption.THIRTY,
                totpCode = "123456",
                type = AuthenticatorItemType.TOTP,
                username = "account name",
                issuer = "issuer",
                algorithm = AuthenticatorItemAlgorithm.SHA1,
                digits = 6,
                favorite = false,
            ),
            minDigitsAllowed = 5,
            maxDigitsAllowed = 10,
        ),
    )
}
