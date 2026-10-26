package com.vowkey.app.data.vault.datasource.sdk.model

/**
 * Models result of derive key connector for the Vowkey SDK.
 */
sealed class DeriveKeyConnectorResult {

    /**
     * Successful derive key operation.
     */
    data class Success(
        val derivedKey: String,
    ) : DeriveKeyConnectorResult()

    /**
     * Generic error.
     */
    data class Error(
        val error: Throwable,
    ) : DeriveKeyConnectorResult()

    /**
     * Incorrect password provided.
     */
    data object WrongPasswordError : DeriveKeyConnectorResult()
}
