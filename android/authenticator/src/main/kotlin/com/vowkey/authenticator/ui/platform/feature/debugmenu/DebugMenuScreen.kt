package com.vowkey.authenticator.ui.platform.feature.debugmenu

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
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.debug.ListItemContent
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Top level screen for the debug menu.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun DebugMenuScreen(
    onNavigateBack: () -> Unit,
    viewModel: DebugMenuViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            DebugMenuEvent.NavigateBack -> onNavigateBack()
        }
    }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(VowkeyString.debug_menu),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = {
                        viewModel.trySendAction(DebugMenuAction.NavigateBack)
                    },
                ),
            )
        },
    ) {
        if (state.featureFlags.isEmpty()) {
            VowkeyErrorContent(
                message = stringResource(id = VowkeyString.empty_item_list),
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            FeatureFlagContent(
                featureFlagMap = state.featureFlags,
                onValueChange = { key, value ->
                    viewModel.trySendAction(DebugMenuAction.UpdateFeatureFlag(key, value))
                },
                onResetValues = { viewModel.trySendAction(DebugMenuAction.ResetFeatureFlagValues) },
                modifier = Modifier
                    .verticalScroll(rememberScrollState()),
            )
        }
    }
}

@Composable
private fun FeatureFlagContent(
    featureFlagMap: Map<FlagKey<Any>, Any>,
    onValueChange: (key: FlagKey<Any>, value: Any) -> Unit,
    onResetValues: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
    ) {
        Spacer(modifier = Modifier.height(12.dp))
        VowkeyListHeaderText(
            label = stringResource(VowkeyString.feature_flags),
            modifier = Modifier
                .standardHorizontalMargin()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(8.dp))
        featureFlagMap.onEach { featureFlag ->
            featureFlag.key.ListItemContent(
                currentValue = featureFlag.value,
                onValueChange = onValueChange,
                cardStyle = featureFlagMap.keys.toListItemCardStyle(
                    index = featureFlagMap.keys.indexOf(element = featureFlag.key),
                ),
                modifier = Modifier.standardHorizontalMargin(),
            )
        }
        Spacer(modifier = Modifier.height(12.dp))
        VowkeyFilledButton(
            label = stringResource(VowkeyString.reset_values),
            onClick = onResetValues,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Preview(showBackground = true)
@Composable
private fun FeatureFlagContent_preview() {
    VowkeyTheme {
        FeatureFlagContent(
            featureFlagMap = mapOf(
                FlagKey.VowkeyAuthenticationEnabled to true,
            ),
            onValueChange = { _, _ -> },
            onResetValues = { },
        )
    }
}
