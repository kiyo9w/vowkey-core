package com.vowkey.app.ui.platform.feature.settings.other

import android.content.res.Resources
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.data.platform.repository.model.ClearClipboardFrequency
import com.vowkey.app.data.platform.repository.util.displayLabel
import kotlinx.collections.immutable.toImmutableList

/**
 * Displays the other screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OtherScreen(
    onNavigateBack: () -> Unit,
    viewModel: OtherViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            OtherEvent.NavigateBack -> onNavigateBack.invoke()
            is OtherEvent.ShowSnackbar -> snackbarHostState.showSnackbar(snackbarData = event.data)
        }
    }

    OtherDialogs(
        dialogState = state.dialogState,
        onDismissRequest = { viewModel.trySendAction(OtherAction.DismissDialog) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.other),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = { viewModel.trySendAction(OtherAction.BackClick) },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        OtherContent(
            state = state,
            onEnableSyncCheckChange = { viewModel.trySendAction(OtherAction.AllowSyncToggle(it)) },
            onSyncClick = { viewModel.trySendAction(OtherAction.SyncNowButtonClick) },
            onClipboardFrequencyChange = {
                viewModel.trySendAction(OtherAction.ClearClipboardFrequencyChange(it))
            },
            onScreenCaptureChange = {
                viewModel.trySendAction(OtherAction.AllowScreenCaptureToggle(it))
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun OtherContent(
    state: OtherState,
    onEnableSyncCheckChange: (Boolean) -> Unit,
    onSyncClick: () -> Unit,
    onClipboardFrequencyChange: (ClearClipboardFrequency) -> Unit,
    onScreenCaptureChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        if (!state.isPreAuth) {
            VowkeySwitch(
                label = stringResource(id = VowkeyString.enable_sync_on_refresh),
                supportingText = stringResource(
                    id = VowkeyString.enable_sync_on_refresh_description,
                ),
                isChecked = state.allowSyncOnRefresh,
                onCheckedChange = onEnableSyncCheckChange,
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = "SyncOnRefreshSwitch")
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 16.dp))

            VowkeyOutlinedButton(
                onClick = onSyncClick,
                label = stringResource(id = VowkeyString.sync_now),
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = "SyncNowButton")
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag(tag = "LastSyncLabel")
                    .standardHorizontalMargin()
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Start,
            ) {
                Text(
                    text = stringResource(id = VowkeyString.last_sync),
                    style = VowkeyTheme.typography.bodySmall,
                    color = VowkeyTheme.colorScheme.text.secondary,
                    modifier = Modifier.padding(end = 2.dp),
                )
                Text(
                    text = state.lastSyncTime,
                    style = VowkeyTheme.typography.bodySmall,
                    color = VowkeyTheme.colorScheme.text.secondary,
                )
            }

            Spacer(modifier = Modifier.height(height = 16.dp))

            ClearClipboardFrequencyRow(
                currentSelection = state.clearClipboardFrequency,
                onFrequencySelection = onClipboardFrequencyChange,
                modifier = Modifier
                    .testTag(tag = "ClearClipboardChooser")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 8.dp))
        }

        ScreenCaptureRow(
            currentValue = state.allowScreenCapture,
            onValueChange = onScreenCaptureChange,
            modifier = Modifier
                .fillMaxWidth()
                .testTag(tag = "AllowScreenCaptureSwitch")
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun ScreenCaptureRow(
    currentValue: Boolean,
    onValueChange: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
) {
    var shouldShowScreenCaptureConfirmDialog by remember { mutableStateOf(false) }

    VowkeySwitch(
        label = stringResource(id = VowkeyString.allow_screen_capture),
        isChecked = currentValue,
        onCheckedChange = {
            if (currentValue) {
                onValueChange(false)
            } else {
                shouldShowScreenCaptureConfirmDialog = true
            }
        },
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )

    if (shouldShowScreenCaptureConfirmDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(VowkeyString.allow_screen_capture),
            message = stringResource(
                VowkeyString.are_you_sure_you_want_to_enable_screen_capture,
            ),
            confirmButtonText = stringResource(VowkeyString.yes),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                onValueChange(true)
                shouldShowScreenCaptureConfirmDialog = false
            },
            onDismissClick = { shouldShowScreenCaptureConfirmDialog = false },
            onDismissRequest = { shouldShowScreenCaptureConfirmDialog = false },
        )
    }
}

@Composable
private fun ClearClipboardFrequencyRow(
    currentSelection: ClearClipboardFrequency,
    onFrequencySelection: (ClearClipboardFrequency) -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    VowkeyMultiSelectButton(
        label = stringResource(id = VowkeyString.clear_clipboard),
        supportingText = stringResource(id = VowkeyString.clear_clipboard_description),
        options = ClearClipboardFrequency.entries.map { it.displayLabel() }.toImmutableList(),
        selectedOption = currentSelection.displayLabel(),
        onOptionSelected = { selectedFrequency ->
            onFrequencySelection(
                ClearClipboardFrequency
                    .entries
                    .first { it.displayLabel.toString(resources) == selectedFrequency },
            )
        },
        textFieldTestTag = "ClearClipboardAfterLabel",
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )
}

@Composable
private fun OtherDialogs(
    dialogState: OtherState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialogState) {
        is OtherState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        is OtherState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title.invoke(),
            message = dialogState.message(),
            onDismissRequest = onDismissRequest,
        )

        null -> Unit
    }
}
