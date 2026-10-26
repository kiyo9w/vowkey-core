package com.vowkey.app.ui.tools.feature.generator.passwordhistory

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.indicator.VowkeyCircularProgressIndicator
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.collections.immutable.persistentListOf

/**
 * Displays the password history screen
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PasswordHistoryScreen(
    onNavigateBack: () -> Unit,
    viewModel: PasswordHistoryViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            PasswordHistoryEvent.NavigateBack -> onNavigateBack.invoke()
        }
    }

    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.password_history),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = {
                    viewModel.trySendAction(PasswordHistoryAction.CloseClick)
                },
                actions = {
                    VowkeyOverflowActionItem(
                        isVisible = state.menuEnabled,
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.clear),
                                onClick = {
                                    viewModel.trySendAction(
                                        PasswordHistoryAction.PasswordClearClick,
                                    )
                                },
                            ),
                        ),
                    )
                },
            )
        },
        content = {
            when (val viewState = state.viewState) {
                is PasswordHistoryState.ViewState.Loading -> {
                    PasswordHistoryLoading(
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                is PasswordHistoryState.ViewState.Error -> {
                    PasswordHistoryError(
                        state = viewState,
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                is PasswordHistoryState.ViewState.Empty -> {
                    PasswordHistoryEmpty(
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                is PasswordHistoryState.ViewState.Content -> {
                    PasswordHistoryContent(
                        state = viewState,
                        modifier = Modifier
                            .fillMaxSize(),
                        onPasswordCopyClick = { password ->
                            viewModel.trySendAction(
                                PasswordHistoryAction.PasswordCopyClick(password),
                            )
                        },
                    )
                }
            }
        },
    )
}

@Composable
private fun PasswordHistoryLoading(modifier: Modifier = Modifier) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        VowkeyCircularProgressIndicator()
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun PasswordHistoryContent(
    state: PasswordHistoryState.ViewState.Content,
    onPasswordCopyClick: (PasswordHistoryState.GeneratedPassword) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        item {
            Spacer(modifier = Modifier.height(height = 12.dp))
        }
        itemsIndexed(state.passwords) { index, password ->
            PasswordHistoryListItem(
                label = password.password,
                supportingLabel = password.date,
                onCopyClick = { onPasswordCopyClick(password) },
                cardStyle = state.passwords.toListItemCardStyle(index = index),
                modifier = Modifier
                    .testTag("GeneratedPasswordRow")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }
        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun PasswordHistoryError(
    state: PasswordHistoryState.ViewState.Error,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = state.message.invoke(),
            style = VowkeyTheme.typography.bodyMedium,
        )
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun PasswordHistoryEmpty(modifier: Modifier = Modifier) {
    Box(
        modifier = modifier,
        contentAlignment = Alignment.Center,
    ) {
        Text(
            modifier = Modifier.testTag("NoPasswordsDisplayedLabel"),
            text = stringResource(id = VowkeyString.no_passwords_to_list),
            style = VowkeyTheme.typography.bodyMedium,
        )
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}
