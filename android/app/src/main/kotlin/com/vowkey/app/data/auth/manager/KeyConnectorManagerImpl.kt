package com.vowkey.app.data.auth.manager

import com.vowkey.core.WrappedAccountCryptographicState
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.core.data.util.flatMap
import com.vowkey.crypto.Kdf
import com.vowkey.network.model.AccountKeysJson
import com.vowkey.network.model.KdfTypeJson
import com.vowkey.network.model.KeyConnectorKeyRequestJson
import com.vowkey.network.model.KeysJson
import com.vowkey.network.service.AccountsService
import com.vowkey.app.data.auth.datasource.sdk.AuthSdkSource
import com.vowkey.app.data.auth.manager.model.MigrateExistingUserToKeyConnectorResult
import com.vowkey.app.data.auth.manager.model.MigrateNewUserToKeyConnectorResult
import com.vowkey.app.data.auth.repository.util.toAccountCryptographicState
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.vault.datasource.sdk.VaultSdkSource
import com.vowkey.app.data.vault.datasource.sdk.model.DeriveKeyConnectorResult

/**
 * The default implementation of the [KeyConnectorManager].
 */
class KeyConnectorManagerImpl(
    private val accountsService: AccountsService,
    private val authSdkSource: AuthSdkSource,
    private val vaultSdkSource: VaultSdkSource,
    private val featureFlagManager: FeatureFlagManager,
) : KeyConnectorManager {
    override suspend fun migrateExistingUserToKeyConnector(
        userId: String,
        url: String,
        userKeyEncrypted: String,
        email: String,
        masterPassword: String,
        kdf: Kdf,
    ): Result<MigrateExistingUserToKeyConnectorResult> =
        vaultSdkSource
            .deriveKeyConnector(
                userId = userId,
                userKeyEncrypted = userKeyEncrypted,
                email = email,
                password = masterPassword,
                kdf = kdf,
            )
            .map { result: DeriveKeyConnectorResult ->
                when (result) {
                    is DeriveKeyConnectorResult.Error -> {
                        MigrateExistingUserToKeyConnectorResult.Error(result.error)
                    }

                    is DeriveKeyConnectorResult.Success -> {
                        accountsService
                            .storeMasterKeyToKeyConnector(
                                url = url,
                                masterKey = result.derivedKey,
                            )
                            .flatMap {
                                accountsService.convertToKeyConnector()
                            }
                            .fold(
                                onSuccess = {
                                    MigrateExistingUserToKeyConnectorResult.Success
                                },
                                onFailure = {
                                    MigrateExistingUserToKeyConnectorResult.Error(it)
                                },
                            )
                    }

                    is DeriveKeyConnectorResult.WrongPasswordError -> {
                        MigrateExistingUserToKeyConnectorResult.WrongPasswordError
                    }
                }
            }

    override suspend fun migrateNewUserToKeyConnector(
        userId: String,
        accountKeys: AccountKeysJson?,
        url: String,
        accessToken: String,
        kdfType: KdfTypeJson,
        kdfIterations: Int?,
        kdfMemory: Int?,
        kdfParallelism: Int?,
        organizationIdentifier: String,
    ): Result<MigrateNewUserToKeyConnectorResult> =
        if (featureFlagManager.getFeatureFlag(FlagKey.V2EncryptionKeyConnector)) {
            authSdkSource
                .postKeysForKeyConnectorRegistration(
                    userId = userId,
                    accessToken = accessToken,
                    keyConnectorUrl = url,
                    ssoOrganizationIdentifier = organizationIdentifier,
                )
                .map {
                    MigrateNewUserToKeyConnectorResult(
                        masterKey = it.keyConnectorKey,
                        encryptedUserKey = it.keyConnectorKeyWrappedUserKey,
                        privateKey = when (val state = it.accountCryptographicState) {
                            is WrappedAccountCryptographicState.V1 -> state.privateKey
                            is WrappedAccountCryptographicState.V2 -> state.privateKey
                        },
                        accountCryptographicState = it.accountCryptographicState,
                    )
                }
        } else {
            legacyMigrateNewUserToKeyConnector(
                accountKeys = accountKeys,
                url = url,
                accessToken = accessToken,
                kdfType = kdfType,
                kdfIterations = kdfIterations,
                kdfMemory = kdfMemory,
                kdfParallelism = kdfParallelism,
                organizationIdentifier = organizationIdentifier,
            )
        }

    @Suppress("LongParameterList")
    private suspend fun legacyMigrateNewUserToKeyConnector(
        accountKeys: AccountKeysJson?,
        url: String,
        accessToken: String,
        kdfType: KdfTypeJson,
        kdfIterations: Int?,
        kdfMemory: Int?,
        kdfParallelism: Int?,
        organizationIdentifier: String,
    ): Result<MigrateNewUserToKeyConnectorResult> =
        authSdkSource
            .makeKeyConnectorKeys()
            .flatMap { keyConnectorResponse ->
                accountsService
                    .storeMasterKeyToKeyConnector(
                        url = url,
                        accessToken = accessToken,
                        masterKey = keyConnectorResponse.masterKey,
                    )
                    .flatMap {
                        accountsService.setKeyConnectorKey(
                            accessToken = accessToken,
                            body = KeyConnectorKeyRequestJson(
                                userKey = keyConnectorResponse.encryptedUserKey,
                                keys = KeysJson(
                                    publicKey = keyConnectorResponse.keys.public,
                                    encryptedPrivateKey = keyConnectorResponse.keys.private,
                                ),
                                kdfType = kdfType,
                                kdfIterations = kdfIterations,
                                kdfMemory = kdfMemory,
                                kdfParallelism = kdfParallelism,
                                organizationIdentifier = organizationIdentifier,
                            ),
                        )
                    }
                    .map {
                        MigrateNewUserToKeyConnectorResult(
                            masterKey = keyConnectorResponse.masterKey,
                            encryptedUserKey = keyConnectorResponse.encryptedUserKey,
                            privateKey = keyConnectorResponse.keys.private,
                            accountCryptographicState = accountKeys.toAccountCryptographicState(
                                privateKey = keyConnectorResponse.keys.private,
                            ),
                        )
                    }
            }
}
