package com.vowkey.network.util

import com.vowkey.network.core.NetworkResultCall
import com.vowkey.network.model.NetworkResult
import retrofit2.Call

/**
 * Synchronously executes the [Call] and returns the [NetworkResult].
 */
internal inline fun <reified T : Any> Call<T>.executeForNetworkResult(): NetworkResult<T> =
    this
        .toNetworkResultCall()
        .executeForResult()

/**
 * Wraps the existing [Call] in a [NetworkResultCall].
 */
internal inline fun <reified T : Any> Call<T>.toNetworkResultCall(): NetworkResultCall<T> =
    NetworkResultCall(
        backingCall = this,
        successType = T::class.java,
    )
