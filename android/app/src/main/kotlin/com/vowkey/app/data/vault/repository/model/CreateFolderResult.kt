package com.vowkey.app.data.vault.repository.model

import com.vowkey.vault.FolderView
import com.vowkey.app.data.platform.util.userFriendlyMessage

/**
 * Models result of creating a folder.
 */
sealed class CreateFolderResult {

    /**
     * Folder created successfully.
     */
    data class Success(val folderView: FolderView) : CreateFolderResult()

    /**
     * Generic error while creating a folder. The optional [errorMessage] may be displayed
     * directly in the UI when present.
     */
    data class Error(
        val error: Throwable,
        val errorMessage: String? = error.userFriendlyMessage,
    ) : CreateFolderResult()
}
