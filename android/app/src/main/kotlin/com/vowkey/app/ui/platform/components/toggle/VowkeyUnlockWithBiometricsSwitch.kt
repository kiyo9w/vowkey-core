package com.vowkey.app.ui.platform.components.toggle

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.platform.manager.biometrics.BiometricSupportStatus

/**
 * Displays a switch for enabling or disabling unlock with biometrics functionality.
 *
 * @param isChecked Indicates that the switch should be checked or not.
 * @param biometricSupportStatus Indicates what type of biometrics are supported on device.
 * @param onDisableBiometrics Callback invoked when the toggle has be turned off.
 * @param onEnableBiometrics Callback invoked when the toggle has be turned on.
 * @param modifier The [Modifier] to be applied to the switch.
 */
@Composable
fun VowkeyUnlockWithBiometricsSwitch(
    biometricSupportStatus: BiometricSupportStatus,
    isChecked: Boolean,
    onDisableBiometrics: () -> Unit,
    onEnableBiometrics: () -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    val biometricsDescription: String = when (biometricSupportStatus) {
        BiometricSupportStatus.CLASS_3_SUPPORTED -> {
            stringResource(VowkeyString.class_3_biometrics_description)
        }

        BiometricSupportStatus.CLASS_2_SUPPORTED -> {
            stringResource(VowkeyString.class_2_biometrics_description)
        }

        BiometricSupportStatus.NOT_SUPPORTED -> return
    }
    VowkeySwitch(
        modifier = modifier,
        label = stringResource(VowkeyString.unlock_with_biometrics),
        isChecked = isChecked,
        onCheckedChange = { toggled ->
            if (toggled) {
                onEnableBiometrics()
            } else {
                onDisableBiometrics()
            }
        },
        enabled = biometricSupportStatus == BiometricSupportStatus.CLASS_3_SUPPORTED,
        supportingText = biometricsDescription,
        cardStyle = cardStyle,
    )
}
