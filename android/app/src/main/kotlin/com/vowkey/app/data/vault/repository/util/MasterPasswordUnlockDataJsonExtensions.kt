package com.vowkey.app.data.vault.repository.util

import com.vowkey.core.MasterPasswordUnlockData
import com.vowkey.network.model.MasterPasswordUnlockDataJson
import com.vowkey.app.data.auth.datasource.sdk.util.toKdf

/**
 * Converts [MasterPasswordUnlockDataJson] to [MasterPasswordUnlockData]
 */
fun MasterPasswordUnlockDataJson.toSdkMasterPasswordUnlock(): MasterPasswordUnlockData =
    MasterPasswordUnlockData(
        kdf = kdf.toKdf(),
        masterKeyWrappedUserKey = masterKeyWrappedUserKey,
        salt = salt,
        containedKeyId = containedKeyId,
    )
