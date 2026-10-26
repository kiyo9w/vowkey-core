package com.vowkey.app.data.credentials.parser

import androidx.credentials.CreatePublicKeyCredentialRequest
import androidx.credentials.GetPublicKeyCredentialOption
import androidx.credentials.provider.BeginGetPublicKeyCredentialOption
import com.vowkey.core.data.util.decodeFromStringOrNull
import com.vowkey.app.data.credentials.model.PasskeyAssertionOptions
import com.vowkey.app.data.credentials.model.PasskeyAttestationOptions
import kotlinx.serialization.json.Json

/**
 * Default implementation of [RelyingPartyParser].
 */
class RelyingPartyParserImpl(
    private val json: Json,
) : RelyingPartyParser {

    override fun parse(
        getPublicKeyCredentialOption: GetPublicKeyCredentialOption,
    ): String? = json
        .decodeFromStringOrNull<PasskeyAssertionOptions>(getPublicKeyCredentialOption.requestJson)
        ?.relyingPartyId

    override fun parse(
        createPublicKeyCredentialRequest: CreatePublicKeyCredentialRequest,
    ): String? = json
        .decodeFromStringOrNull<PasskeyAttestationOptions>(
            createPublicKeyCredentialRequest.requestJson,
        )
        ?.relyingParty
        ?.id

    override fun parse(
        beginGetPublicKeyCredentialOption: BeginGetPublicKeyCredentialOption,
    ): String? = json
        .decodeFromStringOrNull<PasskeyAssertionOptions>(
            beginGetPublicKeyCredentialOption.requestJson,
        )
        ?.relyingPartyId
}
