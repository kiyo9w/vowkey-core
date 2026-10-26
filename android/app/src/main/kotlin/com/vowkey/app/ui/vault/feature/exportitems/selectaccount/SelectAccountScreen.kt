package com.vowkey.app.ui.vault.feature.exportitems.selectaccount

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.credentials.providerevents.exception.ImportCredentialsCancellationException
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.cxf.manager.CredentialExchangeCompletionManager
import com.vowkey.cxf.manager.model.ExportCredentialsResult
import com.vowkey.cxf.ui.composition.LocalCredentialExchangeCompletionManager
import com.vowkey.cxf.ui.composition.LocalCredentialExchangeRequestValidator
import com.vowkey.cxf.validator.CredentialExchangeRequestValidator
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.content.VowkeyEmptyContent
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.exportitems.component.AccountSummaryListItem
import com.vowkey.app.ui.vault.feature.exportitems.component.ExportItemsScaffold
import com.vowkey.app.ui.vault.feature.exportitems.model.AccountSelectionListItem
import com.vowkey.app.ui.vault.feature.exportitems.selectaccount.handlers.rememberSelectAccountHandlers
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.persistentListOf

/**
 * Top level screen for selecting an account to export items from.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod")
fun SelectAccountScreen(
    onAccountSelected: (userId: String, hasOtherAccounts: Boolean) -> Unit,
    viewModel: SelectAccountViewModel = hiltViewModel(),
    credentialExchangeCompletionManager: CredentialExchangeCompletionManager =
        LocalCredentialExchangeCompletionManager.current,
    credentialExchangeRequestValidator: CredentialExchangeRequestValidator =
        LocalCredentialExchangeRequestValidator.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handlers = rememberSelectAccountHandlers(viewModel)
    EventsEffect(viewModel) { event ->
        when (event) {
            SelectAccountEvent.CancelExport -> {
                credentialExchangeCompletionManager
                    .completeCredentialExport(
                        exportResult = ExportCredentialsResult.Failure(
                            error = ImportCredentialsCancellationException(
                                errorMessage = "User cancelled import.",
                            ),
                        ),
                    )
            }

            is SelectAccountEvent.NavigateToPasswordVerification -> {
                onAccountSelected(event.userId, event.hasOtherAccounts)
            }

            is SelectAccountEvent.ValidateImportRequest -> {
                viewModel.trySendAction(
                    SelectAccountAction.ValidateImportRequestResultReceive(
                        isValid = credentialExchangeRequestValidator
                            .validate(event.importCredentialsRequestData),
                    ),
                )
            }
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    ExportItemsScaffold(
        navIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
        navigationIconContentDescription = stringResource(VowkeyString.close),
        onNavigationIconClick = handlers.onCloseClick,
        scrollBehavior = scrollBehavior,
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        when (val viewState = state.viewState) {
            is SelectAccountState.ViewState.Content -> {
                SelectAccountContent(
                    accountSelectionListItems = viewState.accountSelectionListItems,
                    onAccountClick = handlers.onAccountClick,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            SelectAccountState.ViewState.Loading -> {
                VowkeyLoadingContent(
                    text = stringResource(VowkeyString.loading),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            SelectAccountState.ViewState.NoItems -> {
                VowkeyEmptyContent(
                    title = stringResource(VowkeyString.no_accounts_available),
                    titleTestTag = "NoAccountsTitle",
                    text = stringResource(
                        VowkeyString.you_dont_have_any_accounts_you_can_import_from,
                    ),
                    labelTestTag = "NoAccountsText",
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is SelectAccountState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = viewState.message(),
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Composable
private fun SelectAccountContent(
    accountSelectionListItems: ImmutableList<AccountSelectionListItem>,
    onAccountClick: (userId: String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        item { Spacer(Modifier.height(24.dp)) }

        item {
            Text(
                text = stringResource(VowkeyString.select_account),
                textAlign = TextAlign.Center,
                style = VowkeyTheme.typography.titleMedium,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }

        item { Spacer(Modifier.height(16.dp)) }

        itemsIndexed(
            items = accountSelectionListItems,
            key = { _, item -> "AccountSummaryItem_${item.userId}" },
        ) { index, item ->
            AccountSummaryListItem(
                item = item,
                cardStyle = accountSelectionListItems.toListItemCardStyle(index),
                clickable = true,
                onClick = onAccountClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .animateItem(),
            )
        }
        item { Spacer(Modifier.height(16.dp)) }
        item { Spacer(Modifier.navigationBarsPadding()) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(
    showBackground = true,
    name = "Select account content",
    showSystemUi = true,
)
@Composable
private fun SelectAccountContent_preview() {
    ExportItemsScaffold(
        navIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
        navigationIconContentDescription = stringResource(VowkeyString.close),
        onNavigationIconClick = { },
        scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState()),
    ) {
        SelectAccountContent(
            accountSelectionListItems = persistentListOf(
                AccountSelectionListItem(
                    userId = "1",
                    email = "john.doe@example.com",
                    initials = "JD",
                    avatarColorHex = "#FFFF0000",
                    isItemRestricted = false,
                ),
                AccountSelectionListItem(
                    userId = "2",
                    email = "jane.smith@example.com",
                    initials = "JS",
                    avatarColorHex = "#FF00FF00",
                    isItemRestricted = true,
                ),
                AccountSelectionListItem(
                    userId = "3",
                    email = "another.user@example.com",
                    initials = "AU",
                    avatarColorHex = "#FF0000FF",
                    isItemRestricted = false,
                ),
            ),
            onAccountClick = { },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(
    showBackground = true,
    name = "No accounts content",
    showSystemUi = true,
)
@Composable
private fun NoAccountsContent_preview() {
    ExportItemsScaffold(
        navIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
        navigationIconContentDescription = stringResource(VowkeyString.close),
        onNavigationIconClick = { },
        scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState()),
    ) {
        VowkeyEmptyContent(
            title = stringResource(VowkeyString.no_accounts_available),
            titleTestTag = "NoAccountsTitle",
            text = stringResource(
                VowkeyString.you_dont_have_any_accounts_you_can_import_from,
            ),
            labelTestTag = "NoAccountsText",
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(
    showBackground = true,
    name = "Loading content",
    showSystemUi = true,
)
@Composable
private fun LoadingContent_preview() {
    ExportItemsScaffold(
        navIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
        navigationIconContentDescription = stringResource(VowkeyString.close),
        onNavigationIconClick = { },
        scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState()),
    ) {
        VowkeyLoadingContent(
            text = stringResource(VowkeyString.loading),
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(
    name = "Error content",
    showBackground = true,
    showSystemUi = true,
)
@Composable
private fun ErrorContent_preview() {
    ExportItemsScaffold(
        navIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
        navigationIconContentDescription = stringResource(VowkeyString.close),
        onNavigationIconClick = { },
        scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState()),
    ) {
        VowkeyErrorContent(
            message = stringResource(VowkeyString.an_error_has_occurred),
            modifier = Modifier.fillMaxSize(),
        )
    }
}
