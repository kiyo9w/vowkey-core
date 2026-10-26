package com.vowkey.authenticator.ui.authenticator.feature.manualcodeentry

import android.Manifest
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.authenticator.ui.platform.composition.LocalPermissionsManager
import com.vowkey.authenticator.ui.platform.manager.permissions.PermissionsManager
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyPasswordField
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.util.startAppSettingsActivity
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * The screen to manually add a totp code.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ManualCodeEntryScreen(
    onNavigateBack: () -> Unit,
    onNavigateToQrCodeScreen: () -> Unit,
    viewModel: ManualCodeEntryViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    permissionsManager: PermissionsManager = LocalPermissionsManager.current,
) {
    var shouldShowPermissionDialog by rememberSaveable { mutableStateOf(false) }
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()

    val launcher = permissionsManager.getLauncher { isGranted ->
        if (isGranted) {
            viewModel.trySendAction(ManualCodeEntryAction.ScanQrCodeTextClick)
        } else {
            shouldShowPermissionDialog = true
        }
    }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is ManualCodeEntryEvent.NavigateToAppSettings -> {
                intentManager.startAppSettingsActivity()
            }

            is ManualCodeEntryEvent.NavigateToQrCodeScreen -> {
                onNavigateToQrCodeScreen.invoke()
            }

            is ManualCodeEntryEvent.NavigateBack -> {
                onNavigateBack.invoke()
            }
        }
    }

    if (shouldShowPermissionDialog) {
        VowkeyTwoButtonDialog(
            message = stringResource(
                id = VowkeyString.enable_camera_permission_to_use_the_scanner,
            ),
            confirmButtonText = stringResource(id = VowkeyString.settings),
            dismissButtonText = stringResource(id = VowkeyString.no_thanks),
            onConfirmClick = { viewModel.trySendAction(ManualCodeEntryAction.SettingsClick) },
            onDismissClick = { shouldShowPermissionDialog = false },
            onDismissRequest = { shouldShowPermissionDialog = false },
            title = null,
        )
    }

    ManualCodeEntryDialogs(
        dialog = state.dialog,
        onDismissRequest = remember(state) {
            { viewModel.trySendAction(ManualCodeEntryAction.DismissDialog) }
        },
    )

    VowkeyScaffold(
        modifier = Modifier.fillMaxSize(),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.create_verification_code),
                navigationIcon = painterResource(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(ManualCodeEntryAction.CloseClick)
                },
                scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState()),
            )
        },
    ) {
        ManualCodeEntryContent(
            state = state,
            onNameChange = { viewModel.trySendAction(ManualCodeEntryAction.IssuerTextChange(it)) },
            onKeyChange = { viewModel.trySendAction(ManualCodeEntryAction.CodeTextChange(it)) },
            onSaveLocallyClick = {
                viewModel.trySendAction(ManualCodeEntryAction.SaveLocallyClick)
            },
            onSaveToVowkeyClick = {
                viewModel.trySendAction(ManualCodeEntryAction.SaveToVowkeyClick)
            },
            onScanQrCodeClick = {
                if (permissionsManager.checkPermission(Manifest.permission.CAMERA)) {
                    viewModel.trySendAction(ManualCodeEntryAction.ScanQrCodeTextClick)
                } else {
                    launcher.launch(Manifest.permission.CAMERA)
                }
            },
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun ManualCodeEntryContent(
    state: ManualCodeEntryState,
    onNameChange: (name: String) -> Unit,
    onKeyChange: (key: String) -> Unit,
    onSaveLocallyClick: () -> Unit,
    onSaveToVowkeyClick: () -> Unit,
    onScanQrCodeClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier.verticalScroll(state = rememberScrollState())) {
        Spacer(modifier = Modifier.height(height = 24.dp))
        Text(
            text = stringResource(id = VowkeyString.enter_key_manually),
            style = VowkeyTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))
        VowkeyTextField(
            label = stringResource(id = VowkeyString.name),
            value = state.issuer,
            onValueChange = onNameChange,
            cardStyle = CardStyle.Top(),
            textFieldTestTag = "NameTextField",
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        VowkeyPasswordField(
            singleLine = false,
            label = stringResource(id = VowkeyString.key),
            value = state.code,
            onValueChange = onKeyChange,
            cardStyle = CardStyle.Bottom,
            passwordFieldTestTag = "KeyTextField",
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(24.dp))
        SaveManualCodeButtons(
            state = state.buttonState,
            onSaveLocallyClick = onSaveLocallyClick,
            onSaveToVowkeyClick = onSaveToVowkeyClick,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(height = 24.dp))
        Text(
            text = stringResource(id = VowkeyString.cannot_add_authenticator_key),
            color = VowkeyTheme.colorScheme.text.secondary,
            style = VowkeyTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        VowkeyTextButton(
            label = stringResource(id = VowkeyString.scan_qr_code),
            onClick = onScanQrCodeClick,
            modifier = Modifier
                .wrapContentWidth()
                .align(alignment = Alignment.CenterHorizontally)
                .standardHorizontalMargin()
                .testTag("ScanQRCodeButton"),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun ManualCodeEntryDialogs(
    dialog: ManualCodeEntryState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (dialog) {
        is ManualCodeEntryState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialog.title?.invoke(),
                message = dialog.message(),
                onDismissRequest = onDismissRequest,
            )
        }

        is ManualCodeEntryState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialog.message())
        }

        null -> Unit
    }
}
