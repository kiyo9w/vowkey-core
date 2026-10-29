package com.vowkey.app.data.vault.datasource.disk

import com.vowkey.vault.CipherRepromptType
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import com.vowkey.vault.LoginView
import java.time.Instant

internal fun newNativeCipher(type: CipherType): CipherView = CipherView(
    id = null, organizationId = null, folderId = null, collectionIds = emptyList(), key = null,
    name = "", notes = null, type = type, login = null, identity = null, card = null,
    secureNote = null, sshKey = null, bankAccount = null, driversLicense = null, passport = null,
    apiKey = null, environment = null, favorite = false, reprompt = CipherRepromptType.NONE,
    organizationUseTotp = false, edit = true, permissions = null, viewPassword = true,
    localData = null, attachments = null, fields = null, passwordHistory = null,
    creationDate = Instant.now(), deletedDate = null, revisionDate = Instant.now(), archivedDate = null,
    attachmentDecryptionFailures = null, partial = false,
)

internal fun newNativeLogin(): LoginView = LoginView(
    username = "", password = "", passwordRevisionDate = null, uris = emptyList(), totp = null,
    autofillOnPageLoad = null, fido2Credentials = null,
)
