package com.vowkey.app.ui.vault.feature.movetoorganization.util

import com.vowkey.collections.CollectionType
import com.vowkey.collections.CollectionView
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.vault.CipherView
import com.vowkey.app.data.auth.repository.model.UserState
import com.vowkey.app.ui.vault.feature.movetoorganization.VaultMoveToOrganizationState
import com.vowkey.app.ui.vault.model.VaultCollection

/**
 * Transforms a triple of [CipherView] (nullable), list of [CollectionView],
 * and [UserState] (nullable) into a [VaultMoveToOrganizationState.ViewState].
 */
fun Triple<CipherView?, List<CollectionView>, UserState?>.toViewState():
    VaultMoveToOrganizationState.ViewState {
    val userOrganizations = third
        ?.activeAccount
        ?.organizations

    val currentCipher = first

    val collections = second
        .filter { !it.readOnly }

    return when {
        (currentCipher == null) -> {
            VaultMoveToOrganizationState.ViewState.Error(
                VowkeyString.generic_error_message.asText(),
            )
        }

        (userOrganizations?.isNotEmpty() == true) -> {
            VaultMoveToOrganizationState.ViewState.Content(
                selectedOrganizationId = currentCipher
                    .organizationId
                    ?: userOrganizations
                        .first()
                        .id,
                organizations = userOrganizations.map { organization ->
                    VaultMoveToOrganizationState.ViewState.Content.Organization(
                        id = organization.id,
                        name = organization.name,
                        collections = collections
                            .filter { collection ->
                                collection.organizationId == organization.id &&
                                    collection.id != null
                            }
                            .map { collection ->
                                VaultCollection(
                                    id = collection.id.orEmpty(),
                                    name = collection.name,
                                    isSelected = currentCipher
                                        .collectionIds
                                        .contains(collection.id),
                                    isDefaultUserCollection =
                                        collection.type == CollectionType.DEFAULT_USER_COLLECTION,
                                )
                            },
                    )
                },
                cipherToMove = currentCipher,
            )
        }

        else -> VaultMoveToOrganizationState.ViewState.Empty
    }
}
