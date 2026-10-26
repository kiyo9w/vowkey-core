package com.vowkey.network.util

import com.vowkey.core.data.util.decodeFromStringOrNull
import com.vowkey.network.model.VowkeyError
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * Returns the [NetworkErrorCode] for the given error if it is available.
 */
internal fun VowkeyError.getNetworkErrorCodeOrNull(): NetworkErrorCode? =
    (this as? VowkeyError.Http)?.let { httpError ->
        NetworkErrorCode.entries.firstOrNull { httpError.code == it.code }
    }

/**
 * Returns the `true` if the underlying error is from the [code] provided.
 */
internal fun VowkeyError.isErrorCode(
    code: NetworkErrorCode,
): Boolean = (this as? VowkeyError.Http)?.let { code.code == this.code } == true

/**
 * Attempt to parse the error body to serializable type [T].
 *
 * Useful in service layer for parsing non-200 response bodies.
 *
 * If the receiver is not an [HttpException] or the error body cannot be parsed, null will be
 * returned.
 *
 * @param codes a list of HTTP codes associated with the error. Only responses with a matching code
 * will be attempted to be parsed.
 * @param json [Json] serializer to use.
 */
internal inline fun <reified T> VowkeyError.parseErrorBodyOrNull(
    codes: List<NetworkErrorCode>,
    json: Json,
): T? =
    (this as? VowkeyError.Http)
        ?.takeIf { codes.any { it.code == this.code } }
        ?.responseBodyString
        ?.let { responseBody ->
            json.decodeFromStringOrNull(responseBody)
        }

/**
 * Helper for calling [parseErrorBodyOrNull] with a single code.
 */
internal inline fun <reified T> VowkeyError.parseErrorBodyOrNull(
    code: NetworkErrorCode,
    json: Json,
): T? = parseErrorBodyOrNull(codes = listOf(code), json = json)
