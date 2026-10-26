package com.vowkey.authenticator.ui.platform.base

import androidx.compose.runtime.Composable
import com.vowkey.authenticator.ui.platform.composition.LocalManagerProvider
import com.vowkey.authenticator.ui.platform.manager.biometrics.BiometricsManager
import com.vowkey.authenticator.ui.platform.manager.permissions.PermissionsManager
import com.vowkey.ui.platform.base.BaseComposeTest
import com.vowkey.ui.platform.feature.qrcodescan.util.QrCodeAnalyzer
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.exit.ExitManager
import com.vowkey.ui.platform.theme.VowkeyTheme
import io.mockk.mockk

/**
 * A base class that can be used for performing Compose-layer testing using Robolectric, Compose
 * Testing, and JUnit 4.
 */
abstract class AuthenticatorComposeTest : BaseComposeTest() {

    /**
     * Helper for testing a basic Composable function that only requires a Composable environment
     * with the [VowkeyTheme].
     */
    @Suppress("LongParameterList")
    protected fun setContent(
        theme: AppTheme = AppTheme.DEFAULT,
        permissionsManager: PermissionsManager = mockk(),
        intentManager: IntentManager = mockk(),
        exitManager: ExitManager = mockk(),
        biometricsManager: BiometricsManager = mockk(),
        qrCodeAnalyzer: QrCodeAnalyzer = mockk(),
        test: @Composable () -> Unit,
    ) {
        setTestContent {
            VowkeyTheme(theme = theme) {
                LocalManagerProvider(
                    permissionsManager = permissionsManager,
                    intentManager = intentManager,
                    exitManager = exitManager,
                    biometricsManager = biometricsManager,
                    qrCodeAnalyzer = qrCodeAnalyzer,
                    content = test,
                )
            }
        }
    }
}
