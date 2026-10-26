package com.vowkey.app.ui.vault.model

import androidx.annotation.StringRes
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.ui.util.concat

/**
 * Defines all available expiration month options for cards.
 */
enum class VaultCardExpirationMonth(
    val value: Text,
    val number: String,
) {
    SELECT(
        value = VowkeyString.select.asText(),
        number = "0",
    ),
    JANUARY(
        value = VowkeyString.january.dateText("01 - "),
        number = "1",
    ),
    FEBRUARY(
        value = VowkeyString.february.dateText("02 - "),
        number = "2",
    ),
    MARCH(
        value = VowkeyString.march.dateText("03 - "),
        number = "3",
    ),
    APRIL(
        value = VowkeyString.april.dateText("04 - "),
        number = "4",
    ),
    MAY(
        value = VowkeyString.may.dateText("05 - "),
        number = "5",
    ),
    JUNE(
        value = VowkeyString.june.dateText("06 - "),
        number = "6",
    ),
    JULY(
        value = VowkeyString.july.dateText("07 - "),
        number = "7",
    ),
    AUGUST(
        value = VowkeyString.august.dateText("08 - "),
        number = "8",
    ),
    SEPTEMBER(
        value = VowkeyString.september.dateText("09 - "),
        number = "9",
    ),
    OCTOBER(
        value = VowkeyString.october.dateText("10 - "),
        number = "10",
    ),
    NOVEMBER(
        value = VowkeyString.november.dateText("11 - "),
        number = "11",
    ),
    DECEMBER(
        value = VowkeyString.december.dateText("12 - "),
        number = "12",
    ),
}

private fun @receiver:StringRes Int.dateText(prefix: String): Text =
    prefix
        .asText()
        .concat(asText())
