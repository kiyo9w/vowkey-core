package com.vowkey.app.data.platform.manager.sdk.log

import com.vowkey.sdk.LogCallback
import com.vowkey.sdk.LogLevel

/**
 * Creates and manages the logger for the Vowkey SDK.
 */
interface SdkLoggerFactory {
    /**
     * The log level to be used with the Vowkey SDK.
     */
    val logLevel: LogLevel

    /**
     * The [LogCallback] to be used with the Vowkey SDK.
     */
    fun getLogCallback(): LogCallback
}
