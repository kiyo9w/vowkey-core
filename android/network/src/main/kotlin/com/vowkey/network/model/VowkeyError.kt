package com.vowkey.network.model

import com.vowkey.network.exception.CookieRedirectException
import com.vowkey.network.exception.LocalNetworkAccessException
import okhttp3.ResponseBody.Companion.toResponseBody
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

/**
 * Represents different types of errors that can occur in the Vowkey application.
 */
sealed class VowkeyError {
    /**
     * An abstract property that holds the underlying throwable that caused the error.
     */
    abstract val throwable: Throwable

    /**
     * Errors related to HTTP requests and responses.
     */
    data class Http(override val throwable: HttpException) : VowkeyError() {
        /**
         * The error code of the HTTP response.
         */
        val code: Int get() = throwable.code()

        /**
         * The response body of the HTTP response.
         */
        val responseBodyString: String? by lazy {
            throwable.response()?.errorBody()?.string()
        }
    }

    /**
     * Errors related to network.
     */
    data class Network(override val throwable: IOException) : VowkeyError()

    /**
     * Other types of errors not covered by any special cases.
     */
    data class Other(override val throwable: Throwable) : VowkeyError()
}

/**
 * Convert a [Throwable] into a [VowkeyError].
 */
fun Throwable.toVowkeyError(): VowkeyError {
    return when (this) {
        // The LocalNetworkAccessException and CookieRedirectException are subclasses of
        // IOException thrown when specific conditions are met. They must be checked before
        // IOException to avoid being classified as a generic Network error. We synthesize an
        // Http error with a JSON body so the exception's message propagates through the existing
        // parseErrorBodyOrNull pipeline used by service-layer recoverCatching blocks.
        is LocalNetworkAccessException,
        is CookieRedirectException,
            -> {
            VowkeyError.Http(
                throwable = HttpException(
                    Response.error<Any>(
                        HTTP_CODE_BAD_REQUEST,
                        """{"message": "${this.message}"}""".toResponseBody(),
                    ),
                ),
            )
        }

        is IOException -> VowkeyError.Network(this)
        is HttpException -> VowkeyError.Http(this)
        else -> VowkeyError.Other(this)
    }
}

private const val HTTP_CODE_BAD_REQUEST: Int = 400
