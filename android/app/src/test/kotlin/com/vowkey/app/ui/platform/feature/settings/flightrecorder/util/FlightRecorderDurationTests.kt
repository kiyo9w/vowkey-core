package com.vowkey.app.ui.platform.feature.settings.flightrecorder.util

import com.vowkey.data.manager.model.FlightRecorderDuration
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class FlightRecorderDurationTests {
    @Test
    fun `displayText should return appropriate text`() {
        mapOf(
            FlightRecorderDuration.ONE_HOUR to VowkeyString.flight_recorder_one_hour.asText(),
            FlightRecorderDuration.EIGHT_HOURS to
                VowkeyString.flight_recorder_eight_hours.asText(),
            FlightRecorderDuration.TWENTY_FOUR_HOURS to
                VowkeyString.flight_recorder_twenty_four_hours.asText(),
            FlightRecorderDuration.ONE_WEEK to VowkeyString.flight_recorder_one_week.asText(),
        )
            .forEach {
                assertEquals(it.value, it.key.displayText)
            }
    }
}
