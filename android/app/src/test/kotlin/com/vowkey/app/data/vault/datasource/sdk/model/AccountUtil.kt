package com.vowkey.app.data.vault.datasource.sdk.model

import com.vowkey.exporters.Account

/**
 * Creates a mock [com.vowkey.exporters.Account] for testing purposes
 */
fun createMockAccount(
    number: Int,
    email: String = "mockEmail-$number",
    name: String? = "mockName-$number",
): Account = Account(
    id = "mockId-$number",
    email = email,
    name = name,
)
