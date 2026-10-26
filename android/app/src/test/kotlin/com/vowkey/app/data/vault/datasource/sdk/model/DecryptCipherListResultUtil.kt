package com.vowkey.app.data.vault.datasource.sdk.model

import com.vowkey.vault.Cipher
import com.vowkey.vault.CipherListView
import com.vowkey.vault.DecryptCipherListResult

/**
 * Creates a mock [DecryptCipherListResult] for testing purposes.
 */
fun createMockDecryptCipherListResult(
    number: Int,
    successes: List<CipherListView> = listOf(createMockCipherListView(number)),
    failures: List<Cipher> = emptyList(),
): DecryptCipherListResult = DecryptCipherListResult(
    successes = successes,
    failures = failures,
)
