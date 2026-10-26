package com.vowkey.app.data.tools.generator.datasource.sdk

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.generators.PassphraseGeneratorRequest
import com.vowkey.generators.PasswordGeneratorRequest
import com.vowkey.generators.UsernameGeneratorRequest
import com.vowkey.sdk.GeneratorClients
import com.vowkey.app.data.platform.datasource.sdk.BaseSdkSource
import com.vowkey.app.data.platform.manager.SdkClientManager
import kotlinx.coroutines.withContext

/**
 * Implementation of [GeneratorSdkSource] that delegates password generation.
 *
 * @property sdkClientManager The [SdkClientManager] used to retrieve an instance of the
 * [GeneratorClients] provided by the Vowkey SDK.
 */
class GeneratorSdkSourceImpl(
    private val dispatcherManager: DispatcherManager,
    sdkClientManager: SdkClientManager,
) : BaseSdkSource(sdkClientManager = sdkClientManager),
    GeneratorSdkSource {

    override suspend fun generatePassword(
        request: PasswordGeneratorRequest,
    ): Result<String> = runCatchingWithLogs {
        useClient { generators().password(request) }
    }

    override suspend fun generatePassphrase(
        request: PassphraseGeneratorRequest,
    ): Result<String> = runCatchingWithLogs {
        useClient { generators().passphrase(request) }
    }

    override suspend fun generatePlusAddressedEmail(
        request: UsernameGeneratorRequest.Subaddress,
    ): Result<String> = runCatchingWithLogs {
        useClient { generators().username(request) }
    }

    override suspend fun generateCatchAllEmail(
        request: UsernameGeneratorRequest.Catchall,
    ): Result<String> = runCatchingWithLogs {
        useClient { generators().username(request) }
    }

    override suspend fun generateRandomWord(
        request: UsernameGeneratorRequest.Word,
    ): Result<String> = runCatchingWithLogs {
        useClient { generators().username(request) }
    }

    override suspend fun generateForwardedServiceEmail(
        request: UsernameGeneratorRequest.Forwarded,
    ): Result<String> = runCatchingWithLogs {
        withContext(context = dispatcherManager.io) {
            useClient { generators().username(request) }
        }
    }
}
