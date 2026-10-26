package com.vowkey.app.data.auth.util

import com.vowkey.crypto.Kdf
import com.vowkey.network.model.PreLoginResponseJson

/**
 * Convert [PreLoginResponseJson.KdfParams] to [Kdf] params for use with Vowkey SDK.
 */
fun PreLoginResponseJson.KdfParams.toSdkParams(): Kdf = when (this) {
    is PreLoginResponseJson.KdfParams.Argon2ID -> {
        Kdf.Argon2id(
            iterations = this.iterations,
            memory = this.memory,
            parallelism = this.parallelism,
        )
    }

    is PreLoginResponseJson.KdfParams.Pbkdf2 -> {
        Kdf.Pbkdf2(
            iterations = this.iterations,
        )
    }
}
