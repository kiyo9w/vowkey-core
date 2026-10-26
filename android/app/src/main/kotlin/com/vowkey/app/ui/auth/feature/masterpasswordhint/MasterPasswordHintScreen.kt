package com.vowkey.app.ui.auth.feature.masterpasswordhint

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * The top level composable for the Login screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MasterPasswordHintScreen(
    onNavigateBack: () -> Unit,
    viewModel: MasterPasswordHintViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            MasterPasswordHintEvent.NavigateBack -> onNavigateBack()
        }
    }

    when (val dialogState = state.dialog) {
        is MasterPasswordHintState.DialogState.PasswordHintSent -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.password_hint),
                message = stringResource(id = VowkeyString.password_hint_alert),
                onDismissRequest = {
                    viewModel.trySendAction(MasterPasswordHintAction.DismissDialog)
                },
            )
        }

        is MasterPasswordHintState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        is MasterPasswordHintState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState
                    .title
                    ?.invoke()
                    ?: stringResource(id = VowkeyString.an_error_has_occurred),
                message = dialogState.message(),
                throwable = dialogState.error,
                onDismissRequest = {
                    viewModel.trySendAction(MasterPasswordHintAction.DismissDialog)
                },
            )
        }

        null -> Unit
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.password_hint),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(MasterPasswordHintAction.CloseClick)
                },
                actions = {
                    VowkeyTextButton(
                        label = stringResource(id = VowkeyString.submit),
                        onClick = { viewModel.trySendAction(MasterPasswordHintAction.SubmitClick) },
                        modifier = Modifier.testTag("SubmitButton"),
                    )
                },
            )
        },
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            Spacer(modifier = Modifier.height(height = 12.dp))
            VowkeyTextField(
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
                value = state.emailInput,
                onValueChange = {
                    viewModel.trySendAction(MasterPasswordHintAction.EmailInputChange(it))
                },
                label = stringResource(id = VowkeyString.email_address),
                keyboardType = KeyboardType.Email,
                textFieldTestTag = "MasterPasswordHintEmailField",
                supportingText = stringResource(id = VowkeyString.enter_email_for_hint),
                cardStyle = CardStyle.Full,
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
