package com.vowkey.testharness.ui.platform.feature.getpasskey

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.testharness.R
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * Get Passkey test screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GetPasskeyScreen(
    onNavigateBack: () -> Unit,
    viewModel: GetPasskeyViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            GetPasskeyEvent.NavigateBack -> onNavigateBack()
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())

    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = R.string.get_passkey_title),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(VowkeyString.back),
                    onNavigationIconClick = { viewModel.trySendAction(GetPasskeyAction.BackClick) },
                ),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .imePadding()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            VowkeyTextField(
                label = stringResource(R.string.relying_party_id),
                value = state.rpId,
                onValueChange = { viewModel.trySendAction(GetPasskeyAction.RpIdChanged(it)) },
                placeholder = stringResource(R.string.rp_id_hint),
                cardStyle = null,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("PasskeyRelyingPartyIdField"),
            )

            Spacer(modifier = Modifier.height(16.dp))

            VowkeyTextField(
                label = stringResource(R.string.origin_optional),
                value = state.origin,
                onValueChange = { viewModel.trySendAction(GetPasskeyAction.OriginChanged(it)) },
                placeholder = stringResource(R.string.origin_hint),
                cardStyle = null,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("PasskeyOriginField"),
            )

            Spacer(modifier = Modifier.height(16.dp))

            VowkeyFilledButton(
                label = stringResource(R.string.execute),
                onClick = { viewModel.trySendAction(GetPasskeyAction.ExecuteClick) },
                isEnabled = !state.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("GetPasskeyExecuteButton"),
            )

            Spacer(modifier = Modifier.height(12.dp))

            VowkeyTextButton(
                label = stringResource(R.string.clear),
                onClick = { viewModel.trySendAction(GetPasskeyAction.ClearResultClick) },
                isEnabled = !state.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("GetPasskeyClearButton"),
            )

            Spacer(modifier = Modifier.height(16.dp))

            VowkeyTextField(
                label = stringResource(R.string.result),
                value = state.resultText,
                onValueChange = { },
                cardStyle = null,
                readOnly = true,
                singleLine = false,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("GetPasskeyResultTextField"),
            )

            Spacer(modifier = Modifier.height(16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
