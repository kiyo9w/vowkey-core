package com.vowkey.testharness.ui.platform.feature.autofill

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.vowkey.testharness.R
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Placeholder screen for Autofill testing (not yet implemented).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AutofillPlaceholderScreen(
    onNavigateBack: () -> Unit,
    viewModel: AutofillPlaceholderViewModel = hiltViewModel(),
) {
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            AutofillPlaceholderEvent.NavigateBack -> onNavigateBack()
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())

    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = R.string.autofill_testing),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(VowkeyString.back),
                    onNavigationIconClick = {
                        viewModel.trySendAction(AutofillPlaceholderAction.BackClick)
                    },
                ),
            )
        },
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = stringResource(id = R.string.autofill_coming_soon),
                style = VowkeyTheme.typography.bodyLarge,
                color = VowkeyTheme.colorScheme.text.secondary,
            )
        }
    }
}
