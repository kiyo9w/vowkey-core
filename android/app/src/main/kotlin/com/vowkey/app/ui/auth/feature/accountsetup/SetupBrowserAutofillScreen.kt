package com.vowkey.app.ui.auth.feature.accountsetup

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.data.autofill.model.browser.BrowserPackage
import com.vowkey.app.ui.platform.feature.settings.autofill.browser.BrowserAutofillSettingsCard
import com.vowkey.app.ui.platform.feature.settings.autofill.browser.model.BrowserAutofillSettingsOption
import com.vowkey.app.ui.platform.manager.utils.startBrowserAutofillSettingsActivity
import kotlinx.collections.immutable.persistentListOf

/**
 * Top level composable for the Setup Browser Autofill screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun SetupBrowserAutofillScreen(
    viewModel: SetupBrowserAutofillViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            SetupBrowserAutofillEvent.NavigateBack -> onNavigateBack()
            is SetupBrowserAutofillEvent.NavigateToBrowserAutofillSettings -> {
                intentManager.startBrowserAutofillSettingsActivity(
                    browserPackage = event.browserPackage,
                )
            }

            SetupBrowserAutofillEvent.NavigateToBrowserIntegrationsInfo -> {
                intentManager.launchUri(
                    "https://vowkey.app/#download".toUri(),
                )
            }
        }
    }
    SetupBrowserAutofillDialogs(
        dialogState = state.dialogState,
        onDismissDialog = { viewModel.trySendAction(SetupBrowserAutofillAction.DismissDialog) },
        onTurnOnLaterConfirm = {
            viewModel.trySendAction(SetupBrowserAutofillAction.TurnOnLaterConfirmClick)
        },
    )
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(
                    id = if (state.isInitialSetup) {
                        VowkeyString.account_setup
                    } else {
                        VowkeyString.autofill_setup
                    },
                ),
                scrollBehavior = scrollBehavior,
                navigationIcon = if (state.isInitialSetup) {
                    null
                } else {
                    NavigationIcon(
                        navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                        navigationIconContentDescription = stringResource(VowkeyString.close),
                        onNavigationIconClick = {
                            viewModel.trySendAction(SetupBrowserAutofillAction.CloseClick)
                        },
                    )
                },
            )
        },
    ) {
        SetupBrowserAutofillContent(
            state = state,
            onWhyIsThisStepRequiredClick = {
                viewModel.trySendAction(SetupBrowserAutofillAction.WhyIsThisStepRequiredClick)
            },
            onBrowserClick = {
                viewModel.trySendAction(SetupBrowserAutofillAction.BrowserIntegrationClick(it))
            },
            onContinueClick = { viewModel.trySendAction(SetupBrowserAutofillAction.ContinueClick) },
            onTurnOnLaterClick = {
                viewModel.trySendAction(SetupBrowserAutofillAction.TurnOnLaterClick)
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun SetupBrowserAutofillContent(
    state: SetupBrowserAutofillState,
    onWhyIsThisStepRequiredClick: () -> Unit,
    onBrowserClick: (BrowserPackage) -> Unit,
    onContinueClick: () -> Unit,
    onTurnOnLaterClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()),
    ) {
        Spacer(Modifier.height(height = 24.dp))
        Text(
            text = stringResource(id = VowkeyString.turn_on_browser_autofill_integration),
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(Modifier.height(height = 8.dp))
        Text(
            text = stringResource(
                id = if (state.browserCount > 1) {
                    VowkeyString.youre_using_a_browser_that_requires_special_permissions_plural
                } else {
                    VowkeyString.youre_using_a_browser_that_requires_special_permissions_singular
                },
            ),
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        VowkeyClickableText(
            label = stringResource(id = VowkeyString.why_is_this_step_required),
            style = VowkeyTheme.typography.labelMedium,
            onClick = onWhyIsThisStepRequiredClick,
            isExternalLink = true,
            modifier = Modifier
                .wrapContentWidth()
                .align(alignment = Alignment.CenterHorizontally)
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        BrowserAutofillSettingsCard(
            options = state.browserAutofillSettingsOptions,
            onOptionClicked = onBrowserClick,
        )
        Spacer(modifier = Modifier.height(height = 24.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.continue_text),
            onClick = onContinueClick,
            isEnabled = state.isContinueEnabled,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        if (state.isInitialSetup) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeyOutlinedButton(
                label = stringResource(VowkeyString.turn_on_later),
                onClick = onTurnOnLaterClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun SetupBrowserAutofillDialogs(
    dialogState: SetupBrowserAutofillState.DialogState?,
    onTurnOnLaterConfirm: () -> Unit,
    onDismissDialog: () -> Unit,
) {
    when (dialogState) {
        SetupBrowserAutofillState.DialogState.TurnOnLaterDialog -> {
            VowkeyTwoButtonDialog(
                title = stringResource(VowkeyString.turn_on_browser_autofill_integration_later),
                message = stringResource(
                    id = VowkeyString.return_to_complete_this_step_anytime_in_settings,
                ),
                confirmButtonText = stringResource(id = VowkeyString.confirm),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = onTurnOnLaterConfirm,
                onDismissClick = onDismissDialog,
                onDismissRequest = onDismissDialog,
            )
        }

        null -> Unit
    }
}

@Preview(uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SetupBrowserAutofillContent_preview() {
    VowkeyTheme {
        SetupBrowserAutofillContent(
            state = SetupBrowserAutofillState(
                dialogState = null,
                isInitialSetup = true,
                browserAutofillSettingsOptions = persistentListOf(
                    BrowserAutofillSettingsOption.BraveStable(enabled = true),
                    BrowserAutofillSettingsOption.ChromeStable(enabled = false),
                    BrowserAutofillSettingsOption.ChromeBeta(enabled = true),
                ),
            ),
            onWhyIsThisStepRequiredClick = { },
            onBrowserClick = { },
            onContinueClick = { },
            onTurnOnLaterClick = { },
        )
    }
}
