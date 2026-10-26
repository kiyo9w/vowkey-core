package com.vowkey.app.ui.auth.feature.accountsetup

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment.Companion.CenterHorizontally
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Top level composable for the setup complete screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SetupCompleteScreen(
    viewModel: SetupCompleteViewModel = hiltViewModel(),
) {
    val setupCompleteAction: () -> Unit = {
        viewModel.trySendAction(SetupCompleteAction.CompleteSetup)
    }

    // Handle system back action to complete the setup.
    BackHandler(onBack = setupCompleteAction)

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        topBar = {
            VowkeyTopAppBar(
                scrollBehavior = scrollBehavior,
                title = stringResource(VowkeyString.account_setup),
                navigationIcon = null,
            )
        },
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        SetupCompleteContent(
            modifier = Modifier.verticalScroll(rememberScrollState()),
            onContinue = setupCompleteAction,
        )
    }
}

@Composable
private fun SetupCompleteContent(
    modifier: Modifier = Modifier,
    onContinue: () -> Unit,
) {
    Column(
        modifier = modifier,
    ) {
        Spacer(Modifier.height(32.dp))
        Image(
            painter = rememberVectorPainter(VowkeyDrawable.ill_setup_complete),
            contentDescription = null,
            modifier = Modifier
                .align(CenterHorizontally)
                .standardHorizontalMargin()
                .size(size = 100.dp),
        )
        Spacer(Modifier.height(24.dp))
        Text(
            text = stringResource(VowkeyString.youre_all_set),
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(CenterHorizontally)
                .standardHorizontalMargin(),
        )
        Spacer(Modifier.height(8.dp))
        Text(
            text = stringResource(VowkeyString.what_vowkey_has_to_offer),
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .align(CenterHorizontally)
                .standardHorizontalMargin(),
        )
        Spacer(Modifier.height(24.dp))
        VowkeyFilledButton(
            label = stringResource(VowkeyString.continue_text),
            onClick = onContinue,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }
}

@Preview(showBackground = true)
@Preview(showBackground = true, uiMode = android.content.res.Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun SetupCompleteContent_preview() {
    VowkeyTheme {
        Surface {
            SetupCompleteContent(
                modifier = Modifier.fillMaxSize(),
                onContinue = {},
            )
        }
    }
}
