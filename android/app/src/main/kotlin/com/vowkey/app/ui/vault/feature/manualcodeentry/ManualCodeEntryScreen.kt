package com.vowkey.app.ui.vault.feature.manualcodeentry

import android.Manifest
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyHyperTextLink
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.util.startAppSettingsActivity
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.composition.LocalPermissionsManager
import com.vowkey.app.ui.platform.manager.permissions.PermissionsManager

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
                id = VowkeyString.enable_camer_permission_to_use_the_scanner,
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
        state = state.dialog,
        onDismissRequest = { viewModel.trySendAction(ManualCodeEntryAction.DialogDismiss) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.authenticator_key_scanner),
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(ManualCodeEntryAction.CloseClick)
                },
                scrollBehavior = scrollBehavior,
            )
        },
    ) {
        Column(
            modifier = Modifier
                .verticalScroll(state = rememberScrollState())
                .fillMaxSize(),
        ) {
            Spacer(modifier = Modifier.height(height = 24.dp))
            Text(
                text = stringResource(id = VowkeyString.enter_key_manually),
                style = VowkeyTheme.typography.titleMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth()
                    .testTag("EnterKeyManuallyButton"),
            )

            Spacer(modifier = Modifier.height(height = 12.dp))
            Text(
                text = stringResource(id = VowkeyString.once_the_key_is_successfully_entered),
                style = VowkeyTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 24.dp))
            VowkeyTextField(
                singleLine = false,
                label = stringResource(id = VowkeyString.authenticator_key_scanner),
                value = state.code,
                onValueChange = {
                    viewModel.trySendAction(ManualCodeEntryAction.CodeTextChange(it))
                },
                textFieldTestTag = "AddManualTOTPField",
                cardStyle = CardStyle.Full,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(height = 24.dp))
            VowkeyFilledButton(
                label = stringResource(id = VowkeyString.add_totp),
                onClick = { viewModel.trySendAction(ManualCodeEntryAction.CodeSubmit) },
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .testTag("AddManualTOTPButton"),
            )

            Spacer(modifier = Modifier.height(height = 24.dp))
            VowkeyHyperTextLink(
                annotatedResId = VowkeyString.cannot_add_authenticator_key_scan_qr_code,
                annotationKey = "scanQrCode",
                accessibilityString = stringResource(id = VowkeyString.scan_qr_code),
                onClick = {
                    if (permissionsManager.checkPermission(Manifest.permission.CAMERA)) {
                        viewModel.trySendAction(ManualCodeEntryAction.ScanQrCodeTextClick)
                    } else {
                        launcher.launch(Manifest.permission.CAMERA)
                    }
                },
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun ManualCodeEntryDialogs(
    state: ManualCodeEntryState.DialogState?,
    onDismissRequest: () -> Unit,
) {
    when (state) {
        is ManualCodeEntryState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = state.title?.invoke(),
                message = state.message(),
                onDismissRequest = onDismissRequest,
            )
        }

        null -> Unit
    }
}
