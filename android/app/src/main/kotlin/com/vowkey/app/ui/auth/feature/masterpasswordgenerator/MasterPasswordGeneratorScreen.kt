package com.vowkey.app.ui.auth.feature.masterpasswordgenerator

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.TopAppBarScrollBehavior
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.text.VowkeyClickableText
import com.vowkey.ui.platform.components.util.nonLetterColorVisualTransformation
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Top level composable for the master password generator.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
fun MasterPasswordGeneratorScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPreventLockout: () -> Unit,
    onNavigateBackWithPassword: () -> Unit,
    viewModel: MasterPasswordGeneratorViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            MasterPasswordGeneratorEvent.NavigateBack -> onNavigateBack()
            MasterPasswordGeneratorEvent.NavigateToPreventLockout -> onNavigateToPreventLockout()
            is MasterPasswordGeneratorEvent.ShowSnackbar -> {
                snackbarHostState.showSnackbar(
                    snackbarData = VowkeySnackbarData(message = event.text),
                    duration = SnackbarDuration.Short,
                )
            }

            is MasterPasswordGeneratorEvent.NavigateBackToRegistration -> {
                onNavigateBackWithPassword()
            }
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            MasterPasswordGeneratorTopBar(
                scrollBehavior = scrollBehavior,
                onBackClick = {
                    viewModel.trySendAction(MasterPasswordGeneratorAction.BackClickAction)
                },
                onSaveClick = {
                    viewModel.trySendAction(MasterPasswordGeneratorAction.SavePasswordClickAction)
                },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            MasterPasswordGeneratorContent(
                generatedPassword = state.generatedPassword,
                onGenerateNewPassword = {
                    viewModel.trySendAction(
                        MasterPasswordGeneratorAction.GeneratePasswordClickAction,
                    )
                },
                onLearnToPreventLockout = {
                    viewModel.trySendAction(MasterPasswordGeneratorAction.PreventLockoutClickAction)
                },
                modifier = Modifier.standardHorizontalMargin(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun MasterPasswordGeneratorContent(
    generatedPassword: String,
    onGenerateNewPassword: () -> Unit,
    onLearnToPreventLockout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth(),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))
        VowkeyTextField(
            label = null,
            value = generatedPassword,
            onValueChange = {},
            readOnly = true,
            shouldAddCustomLineBreaks = true,
            textStyle = VowkeyTheme.typography.sensitiveInfoSmall,
            visualTransformation = nonLetterColorVisualTransformation(),
            cardStyle = CardStyle.Full,
            modifier = Modifier.fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(12.dp))
        VowkeyFilledButton(
            label = stringResource(VowkeyString.generate_button_label),
            onClick = onGenerateNewPassword,
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_generate),
            modifier = Modifier.fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(12.dp))
        Text(
            text = stringResource(
                VowkeyString.write_this_password_down_and_keep_it_somewhere_safe,
            ),
            style = VowkeyTheme.typography.bodySmall,
            color = VowkeyTheme.colorScheme.text.primary,
        )
        VowkeyClickableText(
            label = stringResource(
                VowkeyString.learn_about_other_ways_to_prevent_account_lockout,
            ),
            style = VowkeyTheme.typography.labelMedium,
            onClick = onLearnToPreventLockout,
            innerPadding = PaddingValues(horizontal = 0.dp, vertical = 4.dp),
        )
    }
}

@Composable
@OptIn(ExperimentalMaterial3Api::class)
private fun MasterPasswordGeneratorTopBar(
    scrollBehavior: TopAppBarScrollBehavior,
    onBackClick: () -> Unit,
    onSaveClick: () -> Unit,
) {
    VowkeyTopAppBar(
        title = stringResource(VowkeyString.generate_master_password),
        scrollBehavior = scrollBehavior,
        navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
        navigationIconContentDescription = stringResource(id = VowkeyString.back),
        onNavigationIconClick = onBackClick,
        actions = {
            VowkeyTextButton(
                label = stringResource(id = VowkeyString.save),
                onClick = onSaveClick,
            )
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Preview
@Composable
private fun MasterPasswordGeneratorTopBarPreview() {
    VowkeyTheme {
        MasterPasswordGeneratorTopBar(
            scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(),
            onBackClick = { },
            onSaveClick = { },
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun MasterPasswordGeneratorContentPreview() {
    VowkeyTheme {
        MasterPasswordGeneratorContent(
            generatedPassword = "really-secure-password",
            onGenerateNewPassword = { },
            onLearnToPreventLockout = { },
            modifier = Modifier.padding(16.dp),
        )
    }
}
