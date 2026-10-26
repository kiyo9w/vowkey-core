package com.vowkey.app.ui.auth.feature.preventaccountlockout

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
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.card.VowkeyContentCard
import com.vowkey.ui.platform.components.content.model.ContentBlockData
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.collections.immutable.persistentListOf

/**
 * Top level screen component for the prevent account lockout info screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun PreventAccountLockoutScreen(
    onNavigateBack: () -> Unit,
    viewModel: PreventAccountLockoutViewModel = hiltViewModel(),
) {
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            PreventAccountLockoutEvent.NavigateBack -> onNavigateBack()
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(VowkeyString.prevent_account_lockout),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(PreventAccountLockoutAction.CloseClickAction)
                },
            )
        },
    ) {
        PreventAccountLockoutContent(
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin()
                .verticalScroll(rememberScrollState()),
        )
    }
}

@Composable
private fun PreventAccountLockoutContent(modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = stringResource(VowkeyString.never_lose_access_to_your_vault),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(
                VowkeyString.the_best_way_to_make_sure_you_can_always_access_your_vault,
            ),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        Spacer(modifier = Modifier.height(24.dp))
        VowkeyContentCard(
            contentItems = persistentListOf(
                ContentBlockData(
                    headerText = stringResource(VowkeyString.create_a_hint),
                    subtitleText = stringResource(
                        VowkeyString.your_hint_will_be_send_to_you_via_email_when_you_request_it,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_light_bulb,
                ),
                ContentBlockData(
                    headerText = stringResource(VowkeyString.write_your_password_down),
                    subtitleText = stringResource(VowkeyString.keep_it_secret_keep_it_safe),
                    iconVectorResource = VowkeyDrawable.ic_pencil,
                ),
            ),
        )
    }
    Spacer(modifier = Modifier.navigationBarsPadding())
}

@Preview
@Composable
private fun PreventAccountLockoutScreenPreview() {
    VowkeyTheme {
        PreventAccountLockoutScreen(onNavigateBack = {})
    }
}
