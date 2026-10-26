package com.vowkey.app.ui.platform.feature.debugmenu

import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.layout.Column
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.scrolledContainerBottomDivider
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.model.TopAppBarDividerStyle
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.content.VowkeyEmptyContent
import com.vowkey.ui.platform.components.debug.ListItemContent
import com.vowkey.ui.platform.components.divider.VowkeyHorizontalDivider
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.segment.VowkeySegmentedButton
import com.vowkey.ui.platform.components.segment.SegmentedButtonState
import com.vowkey.ui.platform.components.segment.transition.segmentedContentTransform
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.feature.debugmenu.handler.DebugMenuHandler
import com.vowkey.app.ui.platform.feature.debugmenu.handler.rememberDebugMenuHandler
import kotlinx.collections.immutable.ImmutableMap
import kotlinx.collections.immutable.persistentMapOf
import kotlinx.collections.immutable.toImmutableList

/**
 * Top level screen for the debug menu.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun DebugMenuScreen(
    onNavigateBack: () -> Unit,
    intentManager: IntentManager = LocalIntentManager.current,
    viewModel: DebugMenuViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handler = rememberDebugMenuHandler(viewModel = viewModel)
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            DebugMenuEvent.NavigateBack -> onNavigateBack()
            is DebugMenuEvent.ShareText -> intentManager.shareText(text = event.text)
        }
    }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(connection = scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.debug_menu),
                scrollBehavior = scrollBehavior,
                dividerStyle = TopAppBarDividerStyle.NONE,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = handler.onNavigateBack,
                ),
            )
        },
        utilityBar = {
            VowkeySegmentedButton(
                options = DebugMenuState
                    .MainTypeOption
                    .entries
                    .map {
                        SegmentedButtonState(
                            text = it.label(),
                            onClick = { handler.onMainTypeOptionClick(it) },
                            isChecked = it == state.mainTypeOption,
                            testTag = it.testTag,
                        )
                    }
                    .toImmutableList(),
                modifier = Modifier
                    .scrolledContainerBottomDivider(topAppBarScrollBehavior = scrollBehavior)
                    .fillMaxWidth(),
            )
        },
    ) {
        AnimatedContent(
            targetState = state.mainTypeOption,
            transitionSpec = { this.segmentedContentTransform() },
            label = "DebugContentTransition",
        ) {
            when (it) {
                DebugMenuState.MainTypeOption.FLAGS -> {
                    FeatureFlagContent(
                        featureFlagMap = state.featureFlags,
                        handler = handler,
                    )
                }

                DebugMenuState.MainTypeOption.OPTIONS -> {
                    DebugOptionsContent(handler = handler)
                }
            }
        }
    }
}

@Composable
private fun FeatureFlagContent(
    featureFlagMap: ImmutableMap<FlagKey<Any>, Any>,
    handler: DebugMenuHandler,
    modifier: Modifier = Modifier,
) {
    if (featureFlagMap.isEmpty()) {
        VowkeyEmptyContent(
            text = stringResource(id = VowkeyString.no_feature_flags),
            modifier = modifier,
        )
    } else {
        Column(modifier = modifier.verticalScroll(state = rememberScrollState())) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            featureFlagMap.forEach { featureFlag ->
                featureFlag.key.ListItemContent(
                    currentValue = featureFlag.value,
                    onValueChange = handler.onUpdateFeatureFlag,
                    cardStyle = featureFlagMap.keys.toListItemCardStyle(
                        index = featureFlagMap.keys.indexOf(element = featureFlag.key),
                    ),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth(),
                )
            }
            Spacer(modifier = Modifier.height(height = 16.dp))
            VowkeyFilledButton(
                label = stringResource(id = VowkeyString.reset_values),
                onClick = handler.onResetFeatureFlagValues,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun DebugOptionsContent(
    handler: DebugMenuHandler,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.verticalScroll(state = rememberScrollState())) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        OnboardingSection(handler = handler)

        Spacer(modifier = Modifier.height(height = 16.dp))
        CookiesSection(handler = handler)

        Spacer(modifier = Modifier.height(height = 16.dp))
        PremiumSection(handler = handler)

        Spacer(modifier = Modifier.height(height = 16.dp))
        ReportsSection(handler = handler)

        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Suppress("LongMethod")
@Composable
private fun OnboardingSection(
    handler: DebugMenuHandler,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.onboarding_override),
            modifier = Modifier
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        ButtonWithExplanation(
            label = stringResource(id = VowkeyString.restart_onboarding_cta),
            explanation = stringResource(id = VowkeyString.restart_onboarding_details),
            onClick = handler.onRestartOnboarding,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        ButtonWithExplanation(
            label = stringResource(id = VowkeyString.restart_onboarding_carousel),
            explanation = stringResource(id = VowkeyString.restart_onboarding_carousel_details),
            onClick = handler.onRestartOnboardingCarousel,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.reset_accessibility_disclaimer),
            onClick = handler.onResetAccessibilityDisclaimer,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.reset_coach_mark_tour_status),
            onClick = handler.onResetCoachMarkTourStatuses,
            isEnabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyHorizontalDivider()
    }
}

@Composable
private fun CookiesSection(
    handler: DebugMenuHandler,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.cookies),
            modifier = Modifier
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.trigger_cookie_acquisition),
            onClick = handler.onTriggerCookieAcquisition,
            isEnabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.clear_sso_cookies),
            onClick = handler.onClearSsoCookies,
            isEnabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyHorizontalDivider()
    }
}

@Composable
private fun PremiumSection(
    handler: DebugMenuHandler,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.premium),
            modifier = Modifier
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.reset_premium_upgrade_banner),
            onClick = handler.onResetPremiumUpgradeBanner,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.show_upgraded_to_premium_card),
            onClick = handler.onShowUpgradedToPremiumCard,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        VowkeyHorizontalDivider()
    }
}

@Composable
private fun ReportsSection(
    handler: DebugMenuHandler,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        VowkeyListHeaderText(
            label = stringResource(id = VowkeyString.error_reports),
            modifier = Modifier
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.share_settings),
            onClick = handler.onShareSettingsClick,
            isEnabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.generate_error_report),
            onClick = handler.onGenerateErrorReportClick,
            isEnabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.generate_crash),
            onClick = handler.onGenerateCrashClick,
            isEnabled = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
}

@Composable
private fun ButtonWithExplanation(
    label: String,
    explanation: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        VowkeyFilledButton(
            label = label,
            onClick = onClick,
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(height = 4.dp))
        Text(
            text = explanation,
            style = VowkeyTheme.typography.bodySmall,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun FeatureFlagContent_preview() {
    VowkeyTheme {
        FeatureFlagContent(
            featureFlagMap = persistentMapOf(
                FlagKey.DummyBoolean to true,
            ),
            handler = DebugMenuHandler.createEmpty(),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun DebugOptionsContent_preview() {
    VowkeyTheme {
        DebugOptionsContent(handler = DebugMenuHandler.createEmpty())
    }
}
