package com.vowkey.network.model

import com.vowkey.network.exception.CookieRedirectException
import com.vowkey.network.exception.LocalNetworkAccessException
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import retrofit2.HttpException
import retrofit2.Response
import java.io.IOException

class VowkeyErrorTest {

    @Test
    fun `toVowkeyError with CookieRedirectException should return Http with status 400`() {
        val exception = CookieRedirectException(hostname = "example.com", message = "Fail!")

        val result = exception.toVowkeyError()

        assertTrue(result is VowkeyError.Http)
        val httpError = result as VowkeyError.Http
        assertEquals(400, httpError.code)
    }

    @Test
    fun `toVowkeyError with CookieRedirectException should include message in body`() {
        val message = "Your request was interrupted because " +
            "the app needed to re-authenticate. Please try again."
        val exception = CookieRedirectException(hostname = "example.com", message = message)

        val result = exception.toVowkeyError()

        val httpError = result as VowkeyError.Http
        val body = httpError.responseBodyString
        assertTrue(body?.contains(message) == true)
    }

    @Test
    fun `toVowkeyError with LocalNetworkAccessException should return Http with status 400`() {
        val exception = LocalNetworkAccessException(message = "Fail!")

        val result = exception.toVowkeyError()

        assertTrue(result is VowkeyError.Http)
        val httpError = result as VowkeyError.Http
        assertEquals(400, httpError.code)
    }

    @Test
    fun `toVowkeyError with LocalNetworkAccessException should include message in body`() {
        val message = "Fail!"
        val exception = LocalNetworkAccessException(message = message)

        val result = exception.toVowkeyError()

        val httpError = result as VowkeyError.Http
        val body = httpError.responseBodyString
        assertTrue(body?.contains(message) == true)
    }

    @Test
    fun `toVowkeyError with IOException should return Network`() {
        val exception = IOException("network failure")

        val result = exception.toVowkeyError()

        assertTrue(result is VowkeyError.Network)
        assertEquals(exception, result.throwable)
    }

    @Test
    fun `toVowkeyError with HttpException should return Http`() {
        val exception = HttpException(
            Response.error<Unit>(400, "error".toResponseBody()),
        )

        val result = exception.toVowkeyError()

        assertTrue(result is VowkeyError.Http)
        assertEquals(exception, result.throwable)
    }

    @Test
    fun `toVowkeyError with RuntimeException should return Other`() {
        val exception = RuntimeException("unexpected")

        val result = exception.toVowkeyError()

        assertTrue(result is VowkeyError.Other)
        assertEquals(exception, result.throwable)
    }
}
