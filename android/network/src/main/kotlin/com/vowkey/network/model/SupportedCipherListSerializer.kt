package com.vowkey.network.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Unknown future items are omitted without coercing them into an editable type. */
internal object SupportedCipherListSerializer : KSerializer<List<SyncResponseJson.Cipher>> {
    private val delegate = ListSerializer(SyncResponseJson.Cipher.serializer())
    override val descriptor: SerialDescriptor = delegate.descriptor

    override fun serialize(encoder: Encoder, value: List<SyncResponseJson.Cipher>) =
        delegate.serialize(encoder, value)

    override fun deserialize(decoder: Decoder): List<SyncResponseJson.Cipher> {
        val input = decoder as JsonDecoder
        return input.decodeJsonElement().jsonArray.mapNotNull { element ->
            val type = (element as? JsonObject)?.get("type")?.jsonPrimitive?.intOrNull
            if (type !in 1..8 && type != 100 && type != 101) {
                null
            } else {
                input.json.decodeFromJsonElement(
                    SyncResponseJson.Cipher.serializer(),
                    element.withPreservedFields(input),
                )
            }
        }
    }

    private fun JsonElement.withPreservedFields(input: JsonDecoder): JsonElement {
        val cipher = jsonObject
        val fields = cipher["fields"] as? JsonArray ?: return this
        val known = mutableListOf<JsonElement>()
        val preserved = mutableListOf<JsonObject>()
        fields.forEach { field ->
            val type = (field as? JsonObject)?.get("type")?.jsonPrimitive?.intOrNull
            if (type in 0..3 &&
                runCatching {
                    input.json.decodeFromJsonElement(SyncResponseJson.Cipher.Field.serializer(), field)
                }.isSuccess
            ) {
                known += field
            } else if (field is JsonObject) {
                preserved += field
            }
        }
        if (preserved.isEmpty()) return this
        return JsonObject(
            cipher + ("fields" to JsonArray(known)) + ("preservedFields" to JsonArray(preserved)),
        )
    }

}
