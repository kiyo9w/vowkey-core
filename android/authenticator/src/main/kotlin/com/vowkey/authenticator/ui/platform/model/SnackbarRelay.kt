package com.vowkey.authenticator.ui.platform.model

import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import kotlinx.serialization.Serializable

/**
 * Models a relay key to be mapped to an instance of [VowkeySnackbarData] being sent
 * between producers and consumers of the data.
 */
@Serializable
enum class SnackbarRelay {
    IMPORT_SUCCESS,
    ITEM_ADDED,
    ITEM_SAVED,
}
