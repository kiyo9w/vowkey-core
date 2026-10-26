package com.vowkey.app.ui.platform.feature.settings.accountsecurity.managedevices.util

import com.vowkey.network.model.DeviceType
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Converts a [DeviceType] to a human-readable display name.
 * Returns e.g. "Mobile - Android", "Extension - Chrome", "Desktop - Windows".
 */
@Suppress("CyclomaticComplexMethod")
val DeviceType.readableDeviceTypeName: Text
    get() = when (this) {
        DeviceType.ANDROID -> VowkeyString.mobile_platform.asText("Android")
        DeviceType.IOS -> VowkeyString.mobile_platform.asText("iOS")
        DeviceType.CHROME_EXTENSION -> VowkeyString.extension_platform.asText("Chrome")
        DeviceType.FIREFOX_EXTENSION -> VowkeyString.extension_platform.asText("Firefox")
        DeviceType.OPERA_EXTENSION -> VowkeyString.extension_platform.asText("Opera")
        DeviceType.EDGE_EXTENSION -> VowkeyString.extension_platform.asText("Edge")
        DeviceType.WINDOWS_DESKTOP -> VowkeyString.desktop_platform.asText("Windows")
        DeviceType.MAC_OS_DESKTOP -> VowkeyString.desktop_platform.asText("MacOS")
        DeviceType.LINUX_DESKTOP -> VowkeyString.desktop_platform.asText("Linux")
        DeviceType.CHROME_BROWSER -> VowkeyString.web_platform.asText("Chrome")
        DeviceType.FIREFOX_BROWSER -> VowkeyString.web_platform.asText("Firefox")
        DeviceType.OPERA_BROWSER -> VowkeyString.web_platform.asText("Opera")
        DeviceType.EDGE_BROWSER -> VowkeyString.web_platform.asText("Edge")
        DeviceType.IE_BROWSER -> VowkeyString.web_platform.asText("IE")
        DeviceType.UNKNOWN_BROWSER -> VowkeyString.web_platform.asText("Unknown")
        DeviceType.ANDROID_AMAZON -> VowkeyString.mobile_platform.asText("Amazon")
        DeviceType.UWP -> VowkeyString.desktop_platform.asText("Windows UWP")
        DeviceType.SAFARI_BROWSER -> VowkeyString.web_platform.asText("Safari")
        DeviceType.VIVALDI_BROWSER -> VowkeyString.web_platform.asText("Vivaldi")
        DeviceType.VIVALDI_EXTENSION -> VowkeyString.extension_platform.asText("Vivaldi")
        DeviceType.SAFARI_EXTENSION -> VowkeyString.extension_platform.asText("Safari")
        DeviceType.SDK -> VowkeyString.sdk.asText()
        DeviceType.SERVER -> VowkeyString.server.asText()
        DeviceType.WINDOWS_CLI -> VowkeyString.cli_platform.asText("Windows")
        DeviceType.MAC_OS_CLI -> VowkeyString.cli_platform.asText("MacOS")
        DeviceType.LINUX_CLI -> VowkeyString.cli_platform.asText("Linux")
        DeviceType.DUCK_DUCK_GO_BROWSER -> VowkeyString.extension_platform.asText("DuckDuckGo")
        DeviceType.UNKNOWN -> VowkeyString.unknown_device.asText()
    }
