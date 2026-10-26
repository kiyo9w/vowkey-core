package com.vowkey.app.ui.platform.feature.settings

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.row.VowkeyPushRow
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText

/**
 * Displays the settings screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToAbout: () -> Unit,
    onNavigateToAccountSecurity: () -> Unit,
    onNavigateToAppearance: () -> Unit,
    onNavigateToAutoFill: () -> Unit,
    onNavigateToOther: () -> Unit,
    onNavigateToVault: () -> Unit,
    onNavigateToPlan: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            SettingsEvent.NavigateBack -> onNavigateBack()
            SettingsEvent.NavigateAbout -> onNavigateToAbout()
            SettingsEvent.NavigateAccountSecurity -> onNavigateToAccountSecurity()
            SettingsEvent.NavigateAppearance -> onNavigateToAppearance()
            SettingsEvent.NavigateAutoFill -> onNavigateToAutoFill()
            SettingsEvent.NavigateOther -> onNavigateToOther()
            SettingsEvent.NavigateVault -> onNavigateToVault()
            SettingsEvent.NavigateAccountSecurityShortcut -> onNavigateToAccountSecurity()
            SettingsEvent.NavigatePlan -> onNavigateToPlan()
            is SettingsEvent.NavigateToUrl -> intentManager.launchUri(event.url.toUri())
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        topBar = {
            VowkeyMediumTopAppBar(
                title = stringResource(id = VowkeyString.settings),
                scrollBehavior = scrollBehavior,
                navigationIcon = if (state.shouldShowCloseButton) {
                    NavigationIcon(
                        navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                        navigationIconContentDescription = stringResource(
                            id = VowkeyString.close,
                        ),
                        onNavigationIconClick = {
                            viewModel.trySendAction(SettingsAction.CloseClick)
                        },
                    )
                } else {
                    null
                },
            )
        },
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(state = rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            if (state.shouldShowUpgradedToPremiumCard) {
                VowkeyActionCard(
                    cardTitle = stringResource(id = VowkeyString.upgraded_to_premium),
                    cardSubtitle = stringResource(
                        id = VowkeyString.you_now_have_access_to_all_advanced_security_features,
                    ),
                    actionButton = VowkeyButtonData(
                        label = VowkeyString.learn_more.asText(),
                        onClick = {
                            viewModel.trySendAction(SettingsAction.UpgradedToPremiumCardClick)
                        },
                        isExternalLink = true,
                    ),
                    leadingContent = {
                        Icon(
                            painter = rememberVectorPainter(id = VowkeyDrawable.ic_star),
                            contentDescription = null,
                            tint = VowkeyTheme.colorScheme.icon.secondary,
                        )
                    },
                    onDismissClick = {
                        viewModel.trySendAction(SettingsAction.UpgradedToPremiumCardDismiss)
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
                Spacer(modifier = Modifier.height(height = 12.dp))
            }
            state.settingRows.forEachIndexed { index, settingEntry ->
                VowkeyPushRow(
                    text = settingEntry.text(),
                    onClick = {
                        viewModel.trySendAction(SettingsAction.SettingsClick(settingEntry))
                    },
                    notificationCount = state.notificationBadgeCountMap.getOrDefault(
                        key = settingEntry,
                        defaultValue = 0,
                    ),
                    cardStyle = state.settingRows.toListItemCardStyle(
                        index = index,
                        // Start padding, plus icon, plus spacing between text.
                        dividerPadding = 48.dp,
                    ),
                    leadingIcon = IconData.Local(iconRes = settingEntry.vectorIconRes),
                    modifier = Modifier
                        .testTag(tag = settingEntry.testTag)
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
