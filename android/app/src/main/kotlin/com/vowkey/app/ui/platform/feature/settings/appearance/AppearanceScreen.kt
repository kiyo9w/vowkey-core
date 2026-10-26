package com.vowkey.app.ui.platform.feature.settings.appearance

import android.content.res.Resources
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.model.VowkeyHelpButtonData
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.feature.settings.appearance.model.AppLanguage
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.util.displayLabel
import kotlinx.collections.immutable.toImmutableList

/**
 * Displays the appearance screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppearanceScreen(
    onNavigateBack: () -> Unit,
    viewModel: AppearanceViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            AppearanceEvent.NavigateBack -> onNavigateBack.invoke()
            AppearanceEvent.NavigateToWebsiteIconsHelp -> {
                intentManager.launchUri("https://vowkey.com/help/website-icons/".toUri())
            }
        }
    }

    AppearanceDialogs(
        dialogState = state.dialogState,
        onConfirmEnableDynamicColorsClick = {
            viewModel.trySendAction(AppearanceAction.ConfirmEnableDynamicColorsClick)
        },
        onDismissDialog = { viewModel.trySendAction(AppearanceAction.DismissDialog) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.appearance),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = { viewModel.trySendAction(AppearanceAction.BackClick) },
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            LanguageSelectionRow(
                currentSelection = state.language,
                onLanguageSelection = {
                    viewModel.trySendAction(AppearanceAction.LanguageChange(it))
                },
                modifier = Modifier
                    .testTag("LanguageChooser")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
            ThemeSelectionRow(
                currentSelection = state.theme,
                onThemeSelection = { viewModel.trySendAction(AppearanceAction.ThemeChange(it)) },
                modifier = Modifier
                    .testTag("ThemeChooser")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
            if (state.isDynamicColorsSupported) {
                VowkeySwitch(
                    label = stringResource(id = VowkeyString.use_dynamic_colors),
                    isChecked = state.isDynamicColorsEnabled,
                    onCheckedChange = {
                        viewModel.trySendAction(AppearanceAction.DynamicColorsToggle(it))
                    },
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .testTag("DynamicColorsSwitch")
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
            }
            VowkeySwitch(
                label = stringResource(id = VowkeyString.show_website_icons),
                supportingText = stringResource(
                    id = VowkeyString.show_website_icons_description,
                ),
                isChecked = state.showWebsiteIcons,
                onCheckedChange = {
                    viewModel.trySendAction(AppearanceAction.ShowWebsiteIconsToggle(it))
                },
                helpData = VowkeyHelpButtonData(
                    onClick = {
                        viewModel.trySendAction(AppearanceAction.ShowWebsiteIconsTooltipClick)
                    },
                    contentDescription = stringResource(
                        id = VowkeyString.show_website_icons_help,
                    ),
                    isExternalLink = true,
                ),
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .testTag("ShowWebsiteIconsSwitch")
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun AppearanceDialogs(
    dialogState: AppearanceState.DialogState?,
    onConfirmEnableDynamicColorsClick: () -> Unit,
    onDismissDialog: () -> Unit,
) {
    when (dialogState) {
        AppearanceState.DialogState.EnableDynamicColors -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.use_dynamic_colors_question),
                message = stringResource(
                    id = VowkeyString.dynamic_colors_may_not_adhere_to_accessibility_guidelines,
                ),
                confirmButtonText = stringResource(VowkeyString.okay),
                dismissButtonText = stringResource(VowkeyString.cancel),
                onConfirmClick = onConfirmEnableDynamicColorsClick,
                onDismissClick = onDismissDialog,
                onDismissRequest = onDismissDialog,
            )
        }

        else -> Unit
    }
}

@Composable
private fun LanguageSelectionRow(
    currentSelection: AppLanguage,
    onLanguageSelection: (AppLanguage) -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    VowkeyMultiSelectButton(
        label = stringResource(id = VowkeyString.language),
        options = AppLanguage.entries.map { it.text() }.toImmutableList(),
        selectedOption = currentSelection.text(),
        onOptionSelected = { selectedLanguage ->
            onLanguageSelection(
                AppLanguage.entries.first { selectedLanguage == it.text.toString(resources) },
            )
        },
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )
}

@Composable
private fun ThemeSelectionRow(
    currentSelection: AppTheme,
    onThemeSelection: (AppTheme) -> Unit,
    modifier: Modifier = Modifier,
    resources: Resources = LocalResources.current,
) {
    VowkeyMultiSelectButton(
        label = stringResource(id = VowkeyString.theme),
        options = AppTheme.entries.map { it.displayLabel() }.toImmutableList(),
        selectedOption = currentSelection.displayLabel(),
        onOptionSelected = { selectedTheme ->
            onThemeSelection(
                AppTheme.entries.first { selectedTheme == it.displayLabel.toString(resources) },
            )
        },
        supportingText = stringResource(id = VowkeyString.theme_description),
        cardStyle = CardStyle.Full,
        modifier = modifier,
    )
}
