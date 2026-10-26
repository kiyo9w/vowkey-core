package com.vowkey.app.ui.vault.feature.leaveorganization

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
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
import com.vowkey.ui.platform.components.button.VowkeyFilledErrorButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyHyperTextLink
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.leaveorganization.handlers.rememberLeaveOrganizationHandler

/**
 * Top-level composable for the Leave Organization screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LeaveOrganizationScreen(
    onNavigateBack: () -> Unit,
    viewModel: LeaveOrganizationViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handlers = rememberLeaveOrganizationHandler(viewModel)

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            LeaveOrganizationEvent.NavigateBack -> onNavigateBack()
            is LeaveOrganizationEvent.LaunchUri -> {
                intentManager.launchUri(event.uri.toUri())
            }
        }
    }

    LeaveOrganizationDialogs(
        dialogState = state.dialogState,
        onDismissRequest = handlers.onDismissDialog,
        onDismissNoNetworkRequest = handlers.onDismissNoNetworkDialog,
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.leave_organization),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = handlers.onBackClick,
            )
        },
    ) {
        LeaveOrganizationContent(
            state = state,
            onLeaveClick = handlers.onLeaveClick,
            onHelpLinkClick = handlers.onHelpClick,
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun LeaveOrganizationDialogs(
    dialogState: LeaveOrganizationState.DialogState?,
    onDismissRequest: () -> Unit,
    onDismissNoNetworkRequest: () -> Unit,
) {
    when (dialogState) {
        LeaveOrganizationState.DialogState.Loading -> {
            VowkeyLoadingDialog(
                text = stringResource(id = VowkeyString.loading),
            )
        }

        is LeaveOrganizationState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                throwable = dialogState.error,
                onDismissRequest = onDismissRequest,
            )
        }

        is LeaveOrganizationState.DialogState.NoNetwork -> {
            VowkeyBasicDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                throwable = dialogState.error,
                onDismissRequest = onDismissNoNetworkRequest,
            )
        }

        null -> Unit
    }
}

@Suppress("LongMethod")
@Composable
private fun LeaveOrganizationContent(
    state: LeaveOrganizationState,
    onLeaveClick: () -> Unit,
    onHelpLinkClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.height(32.dp))

        Image(
            painter = rememberVectorPainter(id = VowkeyDrawable.ill_leave_organization),
            contentDescription = null,
            contentScale = ContentScale.FillHeight,
            modifier = Modifier
                .standardHorizontalMargin()
                .size(100.dp)
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = stringResource(
                id = VowkeyString.are_you_sure_you_want_to_leave_organization,
            ),
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(16.dp))
        VowkeyHyperTextLink(
            annotatedResId = VowkeyString.leave_organization_warning,
            annotationKey = "learnMore",
            accessibilityString = stringResource(VowkeyString.learn_more),
            onClick = onHelpLinkClick,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            isExternalLink = true,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(
                id = VowkeyString.contact_your_admin_to_regain_access,
            ),
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledErrorButton(
            label = stringResource(
                id = VowkeyString.leave_organization_button,
                state.organizationName,
            ),
            onClick = onLeaveClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview(showBackground = true)
@Composable
private fun LeaveOrganizationScreen_preview() {
    VowkeyTheme {
        val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
        VowkeyScaffold(
            topBar = {
                VowkeyTopAppBar(
                    title = "Leave organization",
                    scrollBehavior = scrollBehavior,
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = "Back",
                    onNavigationIconClick = {},
                )
            },
        ) {
            LeaveOrganizationContent(
                state = LeaveOrganizationState(
                    organizationId = "",
                    organizationName = "Test Organization",
                    dialogState = null,
                ),
                onLeaveClick = {},
                onHelpLinkClick = {},
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}
