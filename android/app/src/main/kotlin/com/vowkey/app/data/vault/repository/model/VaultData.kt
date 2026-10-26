package com.vowkey.app.data.vault.repository.model

import com.vowkey.collections.CollectionView
import com.vowkey.send.SendView
import com.vowkey.vault.DecryptCipherListResult
import com.vowkey.vault.FolderView

/**
 * Represents decrypted vault data.
 *
 * @param decryptCipherListResult Contains the result of decrypting ciphers for display in a list.
 * @param collectionViewList List of decrypted collections.
 * @param folderViewList List of decrypted folders.
 * @param sendViewList List of decrypted sends.
 */
data class VaultData(
    val decryptCipherListResult: DecryptCipherListResult,
    val collectionViewList: List<CollectionView>,
    val folderViewList: List<FolderView>,
    val sendViewList: List<SendView>,
)
