@file:OmitFromCoverage

package com.vowkey.authenticator.ui.platform.composition

import android.app.Activity
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocal
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.compositionLocalOf
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.authenticator.ui.platform.manager.AuthenticatorBuildInfoManagerImpl
import com.vowkey.authenticator.ui.platform.manager.biometrics.BiometricsManager
import com.vowkey.authenticator.ui.platform.manager.biometrics.BiometricsManagerImpl
import com.vowkey.authenticator.ui.platform.manager.permissions.PermissionsManager
import com.vowkey.authenticator.ui.platform.manager.permissions.PermissionsManagerImpl
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.ui.platform.composition.LocalExitManager
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.composition.LocalQrCodeAnalyzer
import com.vowkey.ui.platform.feature.qrcodescan.util.QrCodeAnalyzer
import com.vowkey.ui.platform.feature.qrcodescan.util.QrCodeAnalyzerImpl
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.exit.ExitManager
import com.vowkey.ui.platform.manager.exit.ExitManagerImpl
import java.time.Clock

/**
 * Helper [Composable] that wraps a [content] and provides manager classes via [CompositionLocal].
 */
@Composable
fun LocalManagerProvider(
    activity: Activity = requireNotNull(LocalActivity.current),
    permissionsManager: PermissionsManager = PermissionsManagerImpl(activity),
    clock: Clock = Clock.systemDefaultZone(),
    buildInfoManager: BuildInfoManager = AuthenticatorBuildInfoManagerImpl(),
    intentManager: IntentManager = IntentManager.create(activity, clock, buildInfoManager),
    exitManager: ExitManager = ExitManagerImpl(activity),
    biometricsManager: BiometricsManager = BiometricsManagerImpl(activity),
    qrCodeAnalyzer: QrCodeAnalyzer = QrCodeAnalyzerImpl(),
    content: @Composable () -> Unit,
) {
    CompositionLocalProvider(
        LocalPermissionsManager provides permissionsManager,
        LocalIntentManager provides intentManager,
        LocalExitManager provides exitManager,
        LocalBiometricsManager provides biometricsManager,
        LocalQrCodeAnalyzer provides qrCodeAnalyzer,
        content = content,
    )
}

/**
 * Provides access to the biometrics manager throughout the app.
 */
val LocalBiometricsManager: ProvidableCompositionLocal<BiometricsManager> = compositionLocalOf {
    error("CompositionLocal BiometricsManager not present")
}

/**
 * Provides access to the permission manager throughout the app.
 */
val LocalPermissionsManager: ProvidableCompositionLocal<PermissionsManager> = compositionLocalOf {
    error("CompositionLocal LocalPermissionsManager not present")
}
