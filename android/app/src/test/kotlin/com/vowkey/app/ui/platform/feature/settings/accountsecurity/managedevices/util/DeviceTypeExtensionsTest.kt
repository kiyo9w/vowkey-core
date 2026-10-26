package com.vowkey.app.ui.platform.feature.settings.accountsecurity.managedevices.util

import com.vowkey.network.model.DeviceType
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.DynamicTest.dynamicTest
import org.junit.jupiter.api.TestFactory

class DeviceTypeExtensionsTest {
    @TestFactory
    fun `readableDeviceTypeName returns correct value for each known device type`() =
        listOf(
            DeviceType.ANDROID to VowkeyString.mobile_platform.asText("Android"),
            DeviceType.IOS to VowkeyString.mobile_platform.asText("iOS"),
            DeviceType.CHROME_EXTENSION to VowkeyString.extension_platform.asText("Chrome"),
            DeviceType.FIREFOX_EXTENSION to VowkeyString.extension_platform.asText("Firefox"),
            DeviceType.OPERA_EXTENSION to VowkeyString.extension_platform.asText("Opera"),
            DeviceType.EDGE_EXTENSION to VowkeyString.extension_platform.asText("Edge"),
            DeviceType.WINDOWS_DESKTOP to VowkeyString.desktop_platform.asText("Windows"),
            DeviceType.MAC_OS_DESKTOP to VowkeyString.desktop_platform.asText("MacOS"),
            DeviceType.LINUX_DESKTOP to VowkeyString.desktop_platform.asText("Linux"),
            DeviceType.CHROME_BROWSER to VowkeyString.web_platform.asText("Chrome"),
            DeviceType.FIREFOX_BROWSER to VowkeyString.web_platform.asText("Firefox"),
            DeviceType.OPERA_BROWSER to VowkeyString.web_platform.asText("Opera"),
            DeviceType.EDGE_BROWSER to VowkeyString.web_platform.asText("Edge"),
            DeviceType.IE_BROWSER to VowkeyString.web_platform.asText("IE"),
            DeviceType.UNKNOWN_BROWSER to VowkeyString.web_platform.asText("Unknown"),
            DeviceType.ANDROID_AMAZON to VowkeyString.mobile_platform.asText("Amazon"),
            DeviceType.UWP to VowkeyString.desktop_platform.asText("Windows UWP"),
            DeviceType.SAFARI_BROWSER to VowkeyString.web_platform.asText("Safari"),
            DeviceType.VIVALDI_BROWSER to VowkeyString.web_platform.asText("Vivaldi"),
            DeviceType.VIVALDI_EXTENSION to VowkeyString.extension_platform.asText("Vivaldi"),
            DeviceType.SAFARI_EXTENSION to VowkeyString.extension_platform.asText("Safari"),
            DeviceType.SDK to VowkeyString.sdk.asText(),
            DeviceType.SERVER to VowkeyString.server.asText(),
            DeviceType.WINDOWS_CLI to VowkeyString.cli_platform.asText("Windows"),
            DeviceType.MAC_OS_CLI to VowkeyString.cli_platform.asText("MacOS"),
            DeviceType.LINUX_CLI to VowkeyString.cli_platform.asText("Linux"),
            DeviceType.DUCK_DUCK_GO_BROWSER to
                VowkeyString.extension_platform.asText("DuckDuckGo"),
            DeviceType.UNKNOWN to VowkeyString.unknown_device.asText(),
        ).map { (type, expected) ->
            dynamicTest("$type should return $expected") {
                assertEquals(expected, type.readableDeviceTypeName)
            }
        }
}
