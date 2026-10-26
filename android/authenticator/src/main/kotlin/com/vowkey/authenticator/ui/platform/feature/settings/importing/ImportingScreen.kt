package com.vowkey.authenticator.ui.platform.feature.settings.importing

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.authenticator.data.platform.manager.imports.model.ImportFileFormat
import com.vowkey.authenticator.ui.platform.util.displayLabel
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.model.FileData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import kotlinx.collections.immutable.toImmutableList

/**
 * Top level composable for the importing screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportingScreen(
    viewModel: ImportingViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    onNavigateBack: () -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val importLocationReceive: (FileData) -> Unit = {
        viewModel.trySendAction(ImportAction.ImportLocationReceive(it))
    }
    val launcher = intentManager.getActivityResultLauncher { activityResult ->
        intentManager.getFileDataFromActivityResult(activityResult)?.let {
            importLocationReceive(it)
        }
    }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            ImportEvent.NavigateBack -> onNavigateBack()
            is ImportEvent.NavigateToSelectImportFile -> {
                launcher.launch(
                    intentManager.createFileChooserIntent(
                        withCameraIntents = false,
                        mimeType = event.importFileFormat.mimeType,
                    ),
                )
            }
        }
    }

    when (val dialog = state.dialogState) {
        is ImportState.DialogState.Error -> {
            VowkeyTwoButtonDialog(
                title = dialog.title?.invoke(),
                message = dialog.message.invoke(),
                confirmButtonText = stringResource(id = VowkeyString.get_help),
                onConfirmClick = {
                    intentManager.launchUri("https://vowkey.com/help".toUri())
                },
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onDismissClick = {
                    viewModel.trySendAction(ImportAction.DialogDismiss)
                },
                onDismissRequest = {
                    viewModel.trySendAction(ImportAction.DialogDismiss)
                },
            )
        }

        is ImportState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialog.message())
        }

        null -> Unit
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.import_vault),
                scrollBehavior = scrollBehavior,
                navigationIcon = painterResource(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = { viewModel.trySendAction(ImportAction.CloseButtonClick) },
            )
        },
    ) {
        ImportScreenContent(
            modifier = Modifier.fillMaxSize(),
            state = state,
            onImportFormatOptionSelected = {
                viewModel.trySendAction(ImportAction.ImportFormatOptionSelect(it))
            },
            onImportClick = { viewModel.trySendAction(ImportAction.ImportClick) },
        )
    }
}

@Composable
private fun ImportScreenContent(
    modifier: Modifier = Modifier,
    state: ImportState,
    onImportFormatOptionSelected: (ImportFileFormat) -> Unit,
    onImportClick: () -> Unit,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState()),
    ) {
        val resources = LocalResources.current
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyMultiSelectButton(
            label = stringResource(id = VowkeyString.file_format),
            options = ImportFileFormat.entries.map { it.displayLabel() }.toImmutableList(),
            selectedOption = state.importFileFormat.displayLabel(),
            onOptionSelected = { selectedOptionLabel ->
                val selectedOption = ImportFileFormat
                    .entries
                    .first { it.displayLabel(resources) == selectedOptionLabel }
                onImportFormatOptionSelected(selectedOption)
            },
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .testTag("FileFormatPicker")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.import_vault),
            onClick = onImportClick,
            isExternalLink = true,
            modifier = Modifier
                .testTag("ImportVaultButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 12.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}
