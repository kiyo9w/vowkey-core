package com.vowkey.app.ui.vault.feature.vault.util

import com.vowkey.core.data.util.toFormattedDateStyle
import com.vowkey.core.data.util.toFormattedTimeStyle
import com.vowkey.data.datasource.disk.model.FlightRecorderDataSet
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import java.time.Clock
import java.time.Instant
import java.time.format.FormatStyle

/**
 * Helper function to create a [VowkeySnackbarData] representing the active flight recorder.
 */
fun FlightRecorderDataSet.toSnackbarData(
    clock: Clock,
): VowkeySnackbarData? {
    val expirationTime = this
        .data
        .find { it.isActive && !it.isBannerDismissed }
        ?.let { Instant.ofEpochMilli(it.startTimeMs + it.durationMs) }
        ?: return null
    return VowkeySnackbarData(
        message = VowkeyString.flight_recorder_banner_message.asText(
            expirationTime.toFormattedDateStyle(dateStyle = FormatStyle.SHORT, clock = clock),
            expirationTime.toFormattedTimeStyle(timeStyle = FormatStyle.SHORT, clock = clock),
        ),
        messageHeader = VowkeyString.flight_recorder_banner_title.asText(),
        actionLabel = VowkeyString.go_to_settings.asText(),
        withDismissAction = true,
    )
}
