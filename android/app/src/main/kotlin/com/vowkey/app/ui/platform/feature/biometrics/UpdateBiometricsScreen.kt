package com.vowkey.app.ui.platform.feature.biometrics

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.WindowInsetsSides
import androidx.compose.foundation.layout.displayCutout
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.only
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.union
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ScaffoldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.composition.LocalBiometricsManager
import com.vowkey.app.ui.platform.manager.biometrics.BiometricsManager

/**
 * Top-level composable for the Update Biometrics screen.
 */
@Composable
fun UpdateBiometricsScreen(
    onDismiss: () -> Unit,
    biometricsManager: BiometricsManager = LocalBiometricsManager.current,
    viewModel: UpdateBiometricsViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            UpdateBiometricsEvent.NavigateBack -> onDismiss()
            is UpdateBiometricsEvent.ShowBiometricsPrompt -> {
                biometricsManager.promptBiometrics(
                    onSuccess = {
                        viewModel.trySendAction(
                            UpdateBiometricsAction.BiometricCipherReceived(cipher = it),
                        )
                    },
                    onCancel = { },
                    onLockOut = { },
                    onError = { },
                    cipher = event.cipher,
                )
            }
        }
    }
    BackHandler { viewModel.trySendAction(UpdateBiometricsAction.TurnOffBiometricsClick) }
    UpdateBiometricsDialogs(
        dialogState = state.dialogState,
        onDismissClick = { viewModel.trySendAction(UpdateBiometricsAction.DismissDialog) },
        onConfirmTurnOffClick = {
            viewModel.trySendAction(UpdateBiometricsAction.ConfirmTurnOffClick)
        },
    )

    VowkeyScaffold(
        contentWindowInsets = ScaffoldDefaults
            .contentWindowInsets
            .union(insets = WindowInsets.displayCutout)
            .only(sides = WindowInsetsSides.Horizontal + WindowInsetsSides.Top),
    ) {
        UpdateBiometricsContent(
            onConfirmBiometricsClick = {
                viewModel.trySendAction(UpdateBiometricsAction.ConfirmBiometricsClick)
            },
            onTurnOffClick = {
                viewModel.trySendAction(UpdateBiometricsAction.TurnOffBiometricsClick)
            },
            modifier = Modifier.fillMaxSize(),
        )
    }
}

@Composable
private fun UpdateBiometricsDialogs(
    dialogState: UpdateBiometricsState.DialogState?,
    onDismissClick: () -> Unit,
    onConfirmTurnOffClick: () -> Unit,
) {
    when (dialogState) {
        UpdateBiometricsState.DialogState.DisableBiometricsAndClose -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.turn_off_biometric_question),
                message = stringResource(
                    id = VowkeyString.unlocking_will_require_your_master_password,
                ),
                confirmButtonText = stringResource(id = VowkeyString.turn_off),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onDismissClick = onDismissClick,
                onDismissRequest = onDismissClick,
                onConfirmClick = onConfirmTurnOffClick,
                confirmTextColor = VowkeyTheme.colorScheme.status.error,
            )
        }

        is UpdateBiometricsState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        is UpdateBiometricsState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = onDismissClick,
            )
        }

        null -> Unit
    }
}

@Composable
private fun UpdateBiometricsContent(
    onConfirmBiometricsClick: () -> Unit,
    onTurnOffClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier.verticalScroll(state = rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 32.dp))

        Image(
            painter = rememberVectorPainter(id = VowkeyDrawable.ill_account_setup),
            contentDescription = null,
            contentScale = ContentScale.FillHeight,
            modifier = Modifier
                .standardHorizontalMargin()
                .size(size = 100.dp)
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        Text(
            text = stringResource(id = VowkeyString.keep_unlocking_with_biometrics),
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 12.dp))

        Text(
            text = stringResource(id = VowkeyString.weve_made_a_security_update),
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.secondary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.confirm),
            onClick = onConfirmBiometricsClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 12.dp))

        VowkeyOutlinedButton(
            label = stringResource(id = VowkeyString.turn_off),
            onClick = onTurnOffClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}
