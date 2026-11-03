package com.vowkey.app.ui.platform.feature.settings.flightrecorder

import android.content.res.Resources
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalResources
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.data.manager.model.FlightRecorderDuration
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyHyperTextLink
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.feature.settings.flightrecorder.util.displayText
import kotlinx.collections.immutable.toImmutableList

/**
 * Displays the flight recorder configuration screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FlightRecorderScreen(
    onNavigateBack: () -> Unit,
    viewModel: FlightRecorderViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel) { event ->
        when (event) {
            FlightRecorderEvent.NavigateBack -> onNavigateBack()
            FlightRecorderEvent.NavigateToHelpCenter -> {
                intentManager.launchUri(uri = "https://vowkey.app".toUri())
            }
        }
    }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.enable_flight_recorder_title),
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = { viewModel.trySendAction(FlightRecorderAction.BackClick) },
                scrollBehavior = scrollBehavior,
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.save),
                        onClick = { viewModel.trySendAction(FlightRecorderAction.SaveClick) },
                        modifier = Modifier.testTag("SaveButton"),
                    )
                },
            )
        },
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        FlightRecorderContent(
            state = state,
            onDurationSelected = {
                viewModel.trySendAction(FlightRecorderAction.DurationSelect(it))
            },
            onHelpCenterClick = { viewModel.trySendAction(FlightRecorderAction.HelpCenterClick) },
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun FlightRecorderContent(
    state: FlightRecorderState,
    onDurationSelected: (FlightRecorderDuration) -> Unit,
    onHelpCenterClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(state = rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 24.dp))
        Text(
            text = stringResource(id = VowkeyString.experiencing_an_issue),
            color = VowkeyTheme.colorScheme.text.primary,
            style = VowkeyTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        Text(
            text = stringResource(
                id = VowkeyString.enable_temporary_logging_to_collect_and_inspect_logs_locally,
            ),
            color = VowkeyTheme.colorScheme.text.primary,
            style = VowkeyTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        Text(
            text = stringResource(id = VowkeyString.to_get_started_set_a_logging_duration),
            color = VowkeyTheme.colorScheme.text.primary,
            style = VowkeyTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 24.dp))
        DurationSelectButton(
            selectedOption = state.selectedDuration,
            onOptionSelected = onDurationSelected,
            modifier = Modifier
                .testTag("LoggingDurationChooser")
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 24.dp))
        Text(
            text = stringResource(
                id = VowkeyString.logs_will_be_automatically_deleted_after_30_days,
            ),
            color = VowkeyTheme.colorScheme.text.secondary,
            style = VowkeyTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyHyperTextLink(
            annotatedResId = VowkeyString.for_details_on_what_is_and_isnt_logged,
            annotationKey = "helpCenter",
            accessibilityString = stringResource(id = VowkeyString.vowkey_help_center),
            onClick = onHelpCenterClick,
            color = VowkeyTheme.colorScheme.text.secondary,
            style = VowkeyTheme.typography.bodySmall,
            isExternalLink = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun DurationSelectButton(
    selectedOption: FlightRecorderDuration,
    onOptionSelected: (FlightRecorderDuration) -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    val options = FlightRecorderDuration.entries.map { it.displayText() }.toImmutableList()
    VowkeyMultiSelectButton(
        label = stringResource(id = VowkeyString.logging_duration),
        options = options,
        selectedOption = selectedOption.displayText(),
        onOptionSelected = { selectedOption ->
            onOptionSelected(
                FlightRecorderDuration
                    .entries
                    .first { selectedOption == it.displayText.toString(resources) },
            )
        },
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )
}
