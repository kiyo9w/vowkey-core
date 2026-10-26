package com.vowkey.app.data.tools.generator.datasource.sdk

import com.vowkey.generators.PassphraseGeneratorRequest
import com.vowkey.generators.PasswordGeneratorRequest
import com.vowkey.generators.UsernameGeneratorRequest

/**
 * Source of password generation functionality from the Vowkey SDK.
 */
interface GeneratorSdkSource {

    /**
     * Generates a password returning a [String] wrapped in a [Result].
     */
    suspend fun generatePassword(request: PasswordGeneratorRequest): Result<String>

    /**
     * Generates a passphrase returning a [String] wrapped in a [Result].
     */
    suspend fun generatePassphrase(request: PassphraseGeneratorRequest): Result<String>

    /**
     * Generates a plus addressed email returning a [String] wrapped in a [Result].
     */
    suspend fun generatePlusAddressedEmail(
        request: UsernameGeneratorRequest.Subaddress,
    ): Result<String>

    /**
     * Generates a catch all email returning a [String] wrapped in a [Result].
     */
    suspend fun generateCatchAllEmail(
        request: UsernameGeneratorRequest.Catchall,
    ): Result<String>

    /**
     * Generates a random word username returning a [String] wrapped in a [Result].
     */
    suspend fun generateRandomWord(
        request: UsernameGeneratorRequest.Word,
    ): Result<String>

    /**
     * Generates a forwarded service email returning a [String] wrapped in a [Result].
     */
    suspend fun generateForwardedServiceEmail(
        request: UsernameGeneratorRequest.Forwarded,
    ): Result<String>
}
