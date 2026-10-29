package com.vowkey.app.data.vault.datasource.disk

import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.sdk.captureDecisionBegin
import com.vowkey.sdk.captureDecisionFinish
import com.vowkey.sdk.captureDecisionRequests
import com.vowkey.sdk.captureDecisionTakeFirstAnswers
import com.vowkey.sdk.captureFormBegin
import com.vowkey.sdk.captureFormChoices
import com.vowkey.sdk.captureFormRequests
import com.vowkey.sdk.captureFormTakeFirstAnswers
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.*

class GuestDecision(
    private val json: Json,
    private val store: LocalVaultStore,
    private val auth: AuthDiskSource,
    private val environment: EnvironmentRepository,
) {
    private var guestToken: String? = null
    private var expiresAt = 0L

    suspend fun document(reading: JsonObject, year: Int): JsonElement = withContext(Dispatchers.IO) {
        var plan = captureDecisionBegin(reading.toString(), 0u)
        plan = captureDecisionTakeFirstAnswers(plan, answers(captureDecisionRequests(plan, false)))
        json.parseToJsonElement(captureDecisionFinish(plan, answers(captureDecisionRequests(plan, true)), "", year.toUShort()))
    }

    suspend fun form(fields: JsonArray, held: Set<String>): JsonElement = withContext(Dispatchers.IO) {
        var plan = captureFormBegin(buildJsonObject {
            put("fields", fields); put("held", JsonArray(held.map(::JsonPrimitive)))
        }.toString(), 0u)
        plan = captureFormTakeFirstAnswers(plan, answers(captureFormRequests(plan, false)))
        json.parseToJsonElement(captureFormChoices(plan, answers(captureFormRequests(plan, true))))
    }

    private fun answers(requests: String): String = JsonArray(json.parseToJsonElement(requests).jsonArray.map { request ->
        val allowed = request.jsonObject.filterKeys { it == "state" || it == "questions" || it == "model" }
        check(allowed["state"] is JsonObject && allowed["questions"] is JsonObject)
        post("https://decision.vowkey.com/v1/systemone", authorization(), JsonObject(allowed))
    }).toString()

    private fun authorization(): String {
        val user = auth.userState?.activeUserId
        if (user != null) return checkNotNull(auth.getAccountTokens(user)?.accessToken)
        if (guestToken == null || System.currentTimeMillis() >= expiresAt) {
            val grant = post("${environment.environment.baseIdentityUrl.trimEnd('/')}/guest-decision/grant", null,
                buildJsonObject { put("installationId", store.installationId) })
            guestToken = grant["token"]?.jsonPrimitive?.content
            val seconds = grant["expiresIn"]?.jsonPrimitive?.longOrNull ?: error("The reading service is unavailable.")
            check(seconds > 0)
            expiresAt = System.currentTimeMillis() + seconds * 1000 - 30_000
        }
        return checkNotNull(guestToken)
    }

    private fun post(url: String, token: String?, body: JsonObject): JsonObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"; doOutput = true; connectTimeout = 30_000; readTimeout = 60_000
            setRequestProperty("Content-Type", "application/json")
            token?.let { setRequestProperty("Authorization", "Bearer $it") }
        }
        return try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            check(connection.responseCode in 200..299) { "The reading service is unavailable." }
            connection.inputStream.bufferedReader().use { json.parseToJsonElement(it.readText()).jsonObject }
        } finally { connection.disconnect() }
    }
}
