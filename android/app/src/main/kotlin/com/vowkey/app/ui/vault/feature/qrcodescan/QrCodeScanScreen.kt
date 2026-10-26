package com.vowkey.app.ui.vault.feature.qrcodescan

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.vowkey.ui.platform.base.util.ColorSchemeOverride
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.StatusBarsAppearanceAffect
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.camera.CameraPreview
import com.vowkey.ui.platform.components.camera.QrCodeSquare
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.text.VowkeyHyperTextLink
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalQrCodeAnalyzer
import com.vowkey.ui.platform.feature.qrcodescan.util.QrCodeAnalyzer
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.model.WindowSize
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.platform.util.rememberWindowSize

/**
 * The screen to scan QR codes for the application.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QrCodeScanScreen(
    onNavigateBack: () -> Unit,
    onNavigateToManualCodeEntryScreen: () -> Unit,
    viewModel: QrCodeScanViewModel = hiltViewModel(),
    qrCodeAnalyzer: QrCodeAnalyzer = LocalQrCodeAnalyzer.current,
) {
    qrCodeAnalyzer.onQrCodeScanned = {
        viewModel.trySendAction(QrCodeScanAction.QrCodeScanReceive(it))
    }

    val onEnterKeyManuallyClick = { viewModel.trySendAction(QrCodeScanAction.ManualEntryTextClick) }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is QrCodeScanEvent.NavigateBack -> {
                onNavigateBack.invoke()
            }

            is QrCodeScanEvent.NavigateToManualCodeEntry -> {
                onNavigateToManualCodeEntryScreen.invoke()
            }
        }
    }
    // This screen should always look like it's in dark mode
    ColorSchemeOverride(appTheme = AppTheme.DARK) {
        StatusBarsAppearanceAffect()
        VowkeyScaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                VowkeyTopAppBar(
                    title = stringResource(id = VowkeyString.scan_qr_code),
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                    navigationIconContentDescription = stringResource(id = VowkeyString.close),
                    onNavigationIconClick = {
                        viewModel.trySendAction(QrCodeScanAction.CloseClick)
                    },
                    scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(
                        state = rememberTopAppBarState(),
                    ),
                )
            },
        ) {
            CameraPreview(
                cameraErrorReceive = {
                    viewModel.trySendAction(QrCodeScanAction.CameraSetupErrorReceive)
                },
                analyzer = qrCodeAnalyzer,
                modifier = Modifier.fillMaxSize(),
            )
            when (rememberWindowSize()) {
                WindowSize.Compact -> {
                    QrCodeContentCompact(
                        onEnterKeyManuallyClick = onEnterKeyManuallyClick,
                    )
                }

                WindowSize.Medium -> {
                    QrCodeContentMedium(
                        onEnterKeyManuallyClick = onEnterKeyManuallyClick,
                    )
                }
            }
        }
    }
}

@Composable
private fun QrCodeContentCompact(
    onEnterKeyManuallyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier,
    ) {
        QrCodeSquare(
            squareOutlineSize = 250.dp,
            modifier = Modifier.weight(2f),
        )

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceAround,
            modifier = Modifier
                .weight(1f)
                .fillMaxSize()
                .background(color = VowkeyTheme.colorScheme.background.scrim)
                .padding(horizontal = 16.dp)
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = stringResource(id = VowkeyString.point_your_camera_at_the_qr_code),
                textAlign = TextAlign.Center,
                color = VowkeyTheme.colorScheme.text.primary,
                style = VowkeyTheme.typography.bodyMedium,
                modifier = Modifier.padding(horizontal = 16.dp),
            )

            EnterKeyManuallyText(
                onEnterKeyManuallyClick = onEnterKeyManuallyClick,
            )
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun QrCodeContentMedium(
    onEnterKeyManuallyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier,
    ) {
        QrCodeSquare(
            squareOutlineSize = 200.dp,
            modifier = Modifier.weight(2f),
        )

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceAround,
            modifier = Modifier
                .weight(1f)
                .fillMaxSize()
                .background(color = VowkeyTheme.colorScheme.background.scrim)
                .padding(horizontal = 16.dp)
                .navigationBarsPadding()
                .verticalScroll(rememberScrollState()),
        ) {
            Text(
                text = stringResource(id = VowkeyString.point_your_camera_at_the_qr_code),
                textAlign = TextAlign.Center,
                color = VowkeyTheme.colorScheme.text.primary,
                style = VowkeyTheme.typography.bodySmall,
            )

            EnterKeyManuallyText(
                onEnterKeyManuallyClick = onEnterKeyManuallyClick,
            )
        }
    }
}

@Composable
private fun EnterKeyManuallyText(
    onEnterKeyManuallyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    VowkeyHyperTextLink(
        annotatedResId = VowkeyString.cannot_scan_qr_code_enter_key_manually,
        annotationKey = "enterKeyManually",
        accessibilityString = stringResource(VowkeyString.enter_key_manually),
        onClick = onEnterKeyManuallyClick,
        style = VowkeyTheme.typography.bodySmall,
        color = VowkeyTheme.colorScheme.text.primary,
        modifier = modifier,
    )
}
