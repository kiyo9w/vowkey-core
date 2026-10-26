package com.vowkey.app.ui.auth.feature.completeregistration

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText

/**
 * Creates a mock [CompleteRegistrationDialog.HaveIBeenPwned].
 */
fun createHaveIBeenPwned(
    title: Text = VowkeyString.weak_and_exposed_master_password.asText(),
    message: Text = VowkeyString
        .weak_password_identified_and_found_in_a_data_breach_alert_description
        .asText(),
): CompleteRegistrationDialog.HaveIBeenPwned =
    CompleteRegistrationDialog.HaveIBeenPwned(
        title = title,
        message = message,
    )
