package com.vowkey.network.util

import com.vowkey.core.data.util.asFailure
import com.vowkey.core.data.util.asSuccess
import com.vowkey.network.model.NetworkResult

/**
 * Converts the [NetworkResult] to a [Result].
 */
fun <T> NetworkResult<T>.toResult(): Result<T> =
    when (this) {
        is NetworkResult.Failure -> this.throwable.asFailure()
        is NetworkResult.Success -> this.value.asSuccess()
    }
