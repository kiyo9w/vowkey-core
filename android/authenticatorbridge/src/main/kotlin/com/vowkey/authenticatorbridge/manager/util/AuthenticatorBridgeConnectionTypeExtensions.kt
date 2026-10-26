package com.vowkey.authenticatorbridge.manager.util

import com.vowkey.authenticatorbridge.manager.model.AuthenticatorBridgeConnectionType

/**
 * Convert a [AuthenticatorBridgeConnectionType] to raw package name for connection.
 */
internal fun AuthenticatorBridgeConnectionType.toPackageName() =
    when (this) {
        AuthenticatorBridgeConnectionType.RELEASE -> "com.vowkey.app"
        AuthenticatorBridgeConnectionType.DEV -> "com.vowkey.app.dev"
    }
