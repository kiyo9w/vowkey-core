package com.vowkey.app.ui.auth.feature.loginwithdevice.model

import com.vowkey.app.ui.auth.feature.loginwithdevice.LoginWithDeviceScreen
import kotlinx.serialization.Serializable

/**
 * Represents the different ways you may want to display the [LoginWithDeviceScreen].
 */
@Serializable
enum class LoginWithDeviceType {
    OTHER_DEVICE,
    SSO_ADMIN_APPROVAL,
    SSO_OTHER_DEVICE,
}
