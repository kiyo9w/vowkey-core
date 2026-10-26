package com.vowkey.app.ui.platform.feature.settings.flightrecorder.util

import com.vowkey.data.manager.model.FlightRecorderDuration
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * A helper function to map the [FlightRecorderDuration] to a displayable label.
 */
val FlightRecorderDuration.displayText: Text
    get() = when (this) {
        FlightRecorderDuration.ONE_HOUR -> VowkeyString.flight_recorder_one_hour.asText()
        FlightRecorderDuration.EIGHT_HOURS -> VowkeyString.flight_recorder_eight_hours.asText()
        FlightRecorderDuration.TWENTY_FOUR_HOURS -> {
            VowkeyString.flight_recorder_twenty_four_hours.asText()
        }

        FlightRecorderDuration.ONE_WEEK -> VowkeyString.flight_recorder_one_week.asText()
    }
