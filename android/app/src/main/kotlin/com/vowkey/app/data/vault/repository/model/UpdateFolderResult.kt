package com.vowkey.app.data.vault.repository.model

import com.vowkey.vault.FolderView
import com.vowkey.app.data.platform.util.userFriendlyMessage

/**
 * Models result of updating a folder.
 */
sealed class UpdateFolderResult {

    /**
     * Folder updated successfully.
     */
    data class Success(val folderView: FolderView) : UpdateFolderResult()

    /**
     * Generic error while updating a folder. The optional [errorMessage]
     * may be displayed directly in the UI when present.
     */
    data class Error(
        val error: Throwable? = null,
        val errorMessage: String? = error?.userFriendlyMessage,
    ) : UpdateFolderResult()
}
