package com.vowkey.app.ui.vault.feature.importlogins

import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.compose.animation.Crossfade
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewParameter
import androidx.compose.ui.tooling.preview.PreviewParameterProvider
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.annotatedStringResource
import com.vowkey.ui.platform.base.util.vowkeyBoldSpanStyle
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toAnnotatedString
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.bottomsheet.VowkeyModalBottomSheet
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.card.VowkeyContentCard
import com.vowkey.ui.platform.components.content.model.ContentBlockData
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.importlogins.components.ImportLoginsInstructionStep
import com.vowkey.app.ui.vault.feature.importlogins.handlers.ImportLoginHandler
import com.vowkey.app.ui.vault.feature.importlogins.handlers.rememberImportLoginHandler
import kotlinx.collections.immutable.persistentListOf

private const val IMPORT_HELP_URL = "https://vowkey.app"

/**
 * Top level component for the import logins screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportLoginsScreen(
    onNavigateBack: () -> Unit,
    viewModel: ImportLoginsViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handler = rememberImportLoginHandler(viewModel = viewModel)

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            ImportLoginsEvent.NavigateBack -> onNavigateBack()
            ImportLoginsEvent.OpenHelpLink -> {
                intentManager.startCustomTabsActivity(IMPORT_HELP_URL.toUri())
            }
        }
    }

    ImportLoginsDialogContent(state = state, handler = handler)

    BackHandler(enabled = true) {
        state.viewState.backAction?.let {
            viewModel.trySendAction(it)
        }
    }

    VowkeyModalBottomSheet(
        showBottomSheet = state.showBottomSheet,
        sheetTitle = stringResource(VowkeyString.vowkey_tools),
        onDismiss = handler.onSuccessfulSyncAcknowledged,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        modifier = Modifier.statusBarsPadding(),
    ) { animatedOnDismiss ->
        ImportLoginsSuccessBottomSheetContent(
            onCompleteImportLogins = animatedOnDismiss,
        )
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())

    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(VowkeyString.import_logins),
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
                    onNavigationIconClick = handler.onCloseClick,
                    navigationIconContentDescription = stringResource(VowkeyString.close),
                ),
                scrollBehavior = scrollBehavior,
            )
        },
    ) {
        Crossfade(
            targetState = state.viewState,
            label = "CrossfadeBetweenViewStates",
            modifier = Modifier.fillMaxSize(),
        ) { viewState ->
            when (viewState) {
                ImportLoginsState.ViewState.InitialContent -> {
                    InitialImportLoginsContent(
                        onGetStartedClick = handler.onGetStartedClick,
                        onImportLaterClick = handler.onImportLaterClick,
                    )
                }

                ImportLoginsState.ViewState.ImportStepOne -> {
                    ImportLoginsStepOneContent(
                        onBackClick = handler.onMoveToInitialContent,
                        onContinueClick = handler.onMoveToStepTwo,
                        onHelpClick = handler.onHelpClick,
                    )
                }

                ImportLoginsState.ViewState.ImportStepTwo -> {
                    ImportLoginsStepTwoContent(
                        vaultUrl = state.currentWebVaultUrl,
                        onBackClick = handler.onMoveToStepOne,
                        onContinueClick = handler.onMoveToStepThree,
                        onHelpClick = handler.onHelpClick,
                    )
                }

                ImportLoginsState.ViewState.ImportStepThree -> {
                    ImportLoginsStepThreeContent(
                        onBackClick = handler.onMoveToStepTwo,
                        onContinueClick = handler.onMoveToSyncInProgress,
                        onHelpClick = handler.onHelpClick,
                    )
                }
            }
        }
    }
}

@Composable
private fun ImportLoginsDialogContent(
    state: ImportLoginsState,
    handler: ImportLoginHandler,
) {
    val confirmButtonText = stringResource(VowkeyString.confirm)
    val dismissButtonText = stringResource(VowkeyString.cancel)
    when (val dialogState = state.dialogState) {
        ImportLoginsState.DialogState.GetStarted -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = handler.onDismissDialog,
                confirmButtonText = confirmButtonText,
                dismissButtonText = dismissButtonText,
                onConfirmClick = handler.onConfirmGetStarted,
                onDismissClick = handler.onDismissDialog,
            )
        }

        ImportLoginsState.DialogState.ImportLater -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = handler.onDismissDialog,
                confirmButtonText = confirmButtonText,
                dismissButtonText = dismissButtonText,
                onConfirmClick = handler.onConfirmImportLater,
                onDismissClick = handler.onDismissDialog,
            )
        }

        is ImportLoginsState.DialogState.Error -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = handler.onDismissDialog,
                confirmButtonText = stringResource(VowkeyString.try_again),
                dismissButtonText = stringResource(VowkeyString.import_logins_later),
                onConfirmClick = handler.onRetrySync,
                onDismissClick = handler.onFailedSyncAcknowledged,
            )
        }

        is ImportLoginsState.DialogState.Syncing -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        null -> Unit
    }
}

@Composable
private fun InitialImportLoginsContent(
    onGetStartedClick: () -> Unit,
    onImportLaterClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .fillMaxSize()
            .padding(top = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(
            painter = rememberVectorPainter(VowkeyDrawable.ill_import_logins),
            contentDescription = null,
            modifier = Modifier
                .standardHorizontalMargin()
                .size(124.dp),
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(VowkeyString.give_your_vault_a_head_start),
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier.standardHorizontalMargin(),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(
                VowkeyString
                    .from_your_computer_follow_these_instructions_to_export_saved_passwords,
            ),
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier.standardHorizontalMargin(),
        )
        Spacer(Modifier.height(24.dp))
        VowkeyFilledButton(
            label = stringResource(VowkeyString.get_started),
            onClick = onGetStartedClick,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(Modifier.height(12.dp))
        VowkeyOutlinedButton(
            label = stringResource(VowkeyString.import_logins_later),
            onClick = onImportLaterClick,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(Modifier.navigationBarsPadding())
    }
}

@Suppress("MaxLineLength")
@Composable
private fun ImportLoginsStepOneContent(
    onContinueClick: () -> Unit,
    onBackClick: () -> Unit,
    onHelpClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val instruction1 = annotatedStringResource(
        id = VowkeyString.on_your_computer_log_in_to_your_current_browser_or_password_manager,
    )
    val instruction2 = annotatedStringResource(
        id = VowkeyString.export_your_passwords_this_option_is_usually_found_in_your_settings,
    )
    val instruction3 = annotatedStringResource(
        id = VowkeyString.save_the_exported_file_somewhere_on_your_computer_you_can_find_easily,
    )
    ImportLoginsInstructionStep(
        stepText = stringResource(VowkeyString.step_1_of_3),
        stepTitle = stringResource(VowkeyString.export_your_saved_logins),
        instructions = persistentListOf(
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number1,
                headerText = instruction1,
                subtitleText = null,
            ),
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number2,
                headerText = instruction2,
                subtitleText = null,
            ),
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number3,
                headerText = instruction3,
                subtitleText = stringResource(VowkeyString.delete_this_file_after_import_is_complete)
                    .toAnnotatedString(),
            ),
        ),
        onBackClick = onBackClick,
        onContinueClick = onContinueClick,
        onHelpClick = onHelpClick,
        modifier = modifier,
    )
}

@Composable
private fun ImportLoginsStepTwoContent(
    vaultUrl: String,
    onContinueClick: () -> Unit,
    onBackClick: () -> Unit,
    onHelpClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val instruction1 = annotatedStringResource(
        id = VowkeyString.on_your_computer_open_a_new_browser_tab_and_go_to_vault_vowkey_com,
        args = arrayOf(vaultUrl),
    )
    val instruction2Text = stringResource(VowkeyString.log_in_to_the_vowkey_web_app)
    val instruction2 = buildAnnotatedString {
        withStyle(vowkeyBoldSpanStyle) {
            append(instruction2Text)
        }
    }
    ImportLoginsInstructionStep(
        stepText = stringResource(VowkeyString.step_2_of_3),
        stepTitle = stringResource(VowkeyString.log_in_to_vowkey),
        instructions = persistentListOf(
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number1,
                headerText = instruction1,
                subtitleText = null,
            ),
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number2,
                headerText = instruction2,
                subtitleText = null,
            ),
        ),
        onBackClick = onBackClick,
        onContinueClick = onContinueClick,
        onHelpClick = onHelpClick,
        modifier = modifier,
    )
}

@Suppress("LongMethod", "MaxLineLength")
@Composable
private fun ImportLoginsStepThreeContent(
    onContinueClick: () -> Unit,
    onBackClick: () -> Unit,
    onHelpClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val instruction1 = annotatedStringResource(
        id = VowkeyString.in_the_vowkey_navigation_find_the_tools_option_and_select_import_data,
    )
    val instruction2 = annotatedStringResource(
        id = VowkeyString.fill_out_the_form_and_import_your_saved_password_file,
    )
    val instruction3 = annotatedStringResource(
        id = VowkeyString.select_import_data_in_the_web_app_then_done_to_finish_syncing,
    )
    val instruction4 = annotatedStringResource(
        id = VowkeyString.for_your_security_be_sure_to_delete_your_saved_password_file,
    )
    ImportLoginsInstructionStep(
        stepText = stringResource(VowkeyString.step_3_of_3),
        stepTitle = stringResource(VowkeyString.import_logins_to_vowkey),
        instructions = persistentListOf(
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number1,
                headerText = instruction1,
                subtitleText = null,
            ),
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number2,
                headerText = instruction2,
                subtitleText = null,
            ),
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number3,
                headerText = instruction3,
                subtitleText = null,
            ),
            ContentBlockData(
                iconVectorResource = VowkeyDrawable.ic_number4,
                headerText = instruction4,
                subtitleText = null,
            ),
        ),
        onBackClick = onBackClick,
        ctaText = stringResource(VowkeyString.done_text),
        onContinueClick = onContinueClick,
        onHelpClick = onHelpClick,
        modifier = modifier,
    )
}

@Suppress("LongMethod")
@Composable
private fun ImportLoginsSuccessBottomSheetContent(
    onCompleteImportLogins: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .then(modifier),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Image(
            painter = rememberVectorPainter(VowkeyDrawable.ill_secure_devices),
            contentDescription = null,
            modifier = Modifier
                .standardHorizontalMargin()
                .size(124.dp),
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(VowkeyString.import_successful),
            style = VowkeyTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.standardHorizontalMargin(),
        )
        Spacer(Modifier.height(12.dp))
        Text(
            text = stringResource(
                VowkeyString.manage_your_logins_from_anywhere_with_vowkey_tools,
            ),
            style = VowkeyTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.standardHorizontalMargin(),
        )
        Spacer(Modifier.height(24.dp))
        VowkeyContentCard(
            contentItems = persistentListOf(
                ContentBlockData(
                    headerText = stringResource(VowkeyString.download_the_browser_extension),
                    subtitleText = stringResource(
                        VowkeyString
                            .go_to_vowkey_com_download_to_integrate_vowkey_into_browser,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_puzzle,
                ),
                ContentBlockData(
                    headerText = stringResource(VowkeyString.use_the_web_app),
                    subtitleText = stringResource(
                        VowkeyString.log_in_at_vowkey_com_to_easily_manage_your_account,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_desktop,
                ),
                ContentBlockData(
                    headerText = stringResource(VowkeyString.autofill_passwords),
                    subtitleText = stringResource(
                        VowkeyString.set_up_autofill_on_all_your_devices,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_shield,
                ),
            ),
            modifier = Modifier.standardHorizontalMargin(),
            contentSubtitleTextStyle = VowkeyTheme.typography.bodySmall,
        )
        Spacer(Modifier.height(24.dp))
        VowkeyFilledButton(
            label = stringResource(VowkeyString.got_it),
            onClick = onCompleteImportLogins,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(Modifier.navigationBarsPadding())
    }
}

@Preview
@Preview(uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ImportLoginsInitialContent_preview() {
    VowkeyTheme {
        Column(
            modifier = Modifier.background(
                VowkeyTheme.colorScheme.background.primary,
            ),
        ) {
            InitialImportLoginsContent(
                onGetStartedClick = {},
                onImportLaterClick = {},
            )
        }
    }
}

@Preview
@Preview(uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun ImportLoginsScreenDialog_preview(
    @PreviewParameter(ImportLoginsDialogContentPreviewProvider::class) state: ImportLoginsState,
) {
    VowkeyTheme {
        Column(
            modifier = Modifier.background(
                VowkeyTheme.colorScheme.background.primary,
            ),
        ) {
            ImportLoginsDialogContent(
                state = state,
                handler = ImportLoginHandler(
                    onDismissDialog = {},
                    onConfirmGetStarted = {},
                    onConfirmImportLater = {},
                    onCloseClick = {},
                    onGetStartedClick = {},
                    onImportLaterClick = {},
                    onHelpClick = {},
                    onMoveToInitialContent = {},
                    onMoveToStepOne = {},
                    onMoveToStepTwo = {},
                    onMoveToStepThree = {},
                    onMoveToSyncInProgress = {},
                    onRetrySync = {},
                    onFailedSyncAcknowledged = {},
                    onSuccessfulSyncAcknowledged = {},
                ),
            )
            InitialImportLoginsContent(
                onGetStartedClick = {},
                onImportLaterClick = {},
            )
        }
    }
}

@OmitFromCoverage
private class ImportLoginsDialogContentPreviewProvider :
    PreviewParameterProvider<ImportLoginsState> {
    override val values: Sequence<ImportLoginsState>
        get() = sequenceOf(
            ImportLoginsState(
                dialogState = ImportLoginsState.DialogState.GetStarted,
                viewState = ImportLoginsState.ViewState.InitialContent,
                showBottomSheet = false,
                currentWebVaultUrl = "vault.vowkey.com",
            ),
            ImportLoginsState(
                dialogState = ImportLoginsState.DialogState.ImportLater,
                viewState = ImportLoginsState.ViewState.InitialContent,
                showBottomSheet = false,
                currentWebVaultUrl = "vault.vowkey.com",
            ),
        )
}
