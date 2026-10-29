@file:Suppress("TooManyFunctions")

package com.vowkey.app.ui.vault.feature.itemlisting.util

import androidx.annotation.DrawableRes
import com.vowkey.collections.CollectionView
import com.vowkey.core.data.util.toFormattedDateTimeStyle
import com.vowkey.send.SendType
import com.vowkey.send.SendView
import com.vowkey.ui.platform.base.util.toHostOrPathOrNull
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.model.TotpData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.vault.CipherListView
import com.vowkey.vault.CipherListViewType
import com.vowkey.vault.CipherRepromptType
import com.vowkey.vault.CipherView
import com.vowkey.vault.FolderView
import com.vowkey.app.data.autofill.model.AutofillSelectionData
import com.vowkey.app.data.autofill.util.isActiveWithFido2Credentials
import com.vowkey.app.data.autofill.util.login
import com.vowkey.app.data.credentials.model.CreateCredentialRequest
import com.vowkey.app.data.platform.util.isActive
import com.vowkey.app.data.vault.repository.model.VaultData
import com.vowkey.app.data.vault.repository.util.toFailureCipherListView
import com.vowkey.app.ui.tools.feature.send.util.toLabelIcons
import com.vowkey.app.ui.tools.feature.send.util.toOverflowActions
import com.vowkey.app.ui.vault.feature.itemlisting.VaultItemListingState
import com.vowkey.app.ui.vault.feature.util.getCollections
import com.vowkey.app.ui.vault.feature.util.getFolders
import com.vowkey.app.ui.vault.feature.util.toCollectionDisplayName
import com.vowkey.app.ui.vault.feature.util.toFolderDisplayName
import com.vowkey.app.ui.vault.feature.util.toLabelIcons
import com.vowkey.app.ui.vault.feature.util.toOverflowActions
import com.vowkey.app.ui.vault.feature.vault.model.VaultFilterType
import com.vowkey.app.ui.vault.feature.vault.util.applyRestrictItemTypesPolicy
import com.vowkey.app.ui.vault.feature.vault.util.toFilteredList
import com.vowkey.app.ui.vault.feature.vault.util.toLoginIconData
import com.vowkey.app.ui.vault.util.toSdkCipherType
import java.time.Clock
import java.time.format.FormatStyle

/**
 * Determines a predicate to filter a list of [CipherView] based on the
 * [VaultItemListingState.ItemListingType].
 */
fun CipherListView.determineListingPredicate(
    itemListingType: VaultItemListingState.ItemListingType.Vault,
): Boolean =
    when (itemListingType) {
        is VaultItemListingState.ItemListingType.Vault.Card -> {
            type is CipherListViewType.Card && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.Collection -> {
            itemListingType.collectionId in this.collectionIds && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.Folder -> {
            folderId == itemListingType.folderId && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.Identity -> {
            type is CipherListViewType.Identity && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.Login -> {
            type is CipherListViewType.Login && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.SecureNote -> {
            type is CipherListViewType.SecureNote && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.SshKey -> {
            type is CipherListViewType.SshKey && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.BankAccount -> {
            type is CipherListViewType.BankAccount && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.License -> {
            type is CipherListViewType.DriversLicense && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.Passport -> {
            type is CipherListViewType.Passport && isActive
        }

        is VaultItemListingState.ItemListingType.Vault.Trash -> {
            deletedDate != null
        }

        is VaultItemListingState.ItemListingType.Vault.Archive -> {
            archivedDate != null && deletedDate == null
        }
    }

/**
 * Determines a predicate to filter a list of [CipherView] based on the
 * [VaultItemListingState.ItemListingType].
 */
fun SendView.determineListingPredicate(
    itemListingType: VaultItemListingState.ItemListingType.Send,
): Boolean =
    when (itemListingType) {
        is VaultItemListingState.ItemListingType.Send.SendFile -> {
            type == SendType.FILE
        }

        is VaultItemListingState.ItemListingType.Send.SendText -> {
            type == SendType.TEXT
        }
    }

/**
 * Transforms a list of [CipherListView] into [VaultItemListingState.ViewState].
 */
@Suppress("CyclomaticComplexMethod", "LongMethod", "LongParameterList", "NestedBlockDepth")
fun VaultData.toViewState(
    itemListingType: VaultItemListingState.ItemListingType.Vault,
    vaultFilterType: VaultFilterType,
    hasMasterPassword: Boolean,
    baseIconUrl: String,
    isIconLoadingDisabled: Boolean,
    autofillSelectionData: AutofillSelectionData?,
    createCredentialRequestData: CreateCredentialRequest?,
    totpData: TotpData?,
    isPremiumUser: Boolean,
    restrictItemTypesPolicyOrgIds: List<String>,
    isVfo1FoundationEnabled: Boolean = false,
): VaultItemListingState.ViewState {
    val filteredCipherViewList = decryptCipherListResult
        .successes
        .applyFilters(
            itemListingType = itemListingType,
            vaultFilterType = vaultFilterType,
            restrictItemTypesPolicyOrgIds = restrictItemTypesPolicyOrgIds,
        )

    val failuresCipherViewList = decryptCipherListResult
        .failures
        .map { cipher ->
            cipher.toFailureCipherListView()
        }

    val filteredFailuresCipherViewList = failuresCipherViewList
        .applyFilters(
            itemListingType = itemListingType,
            vaultFilterType = vaultFilterType,
            restrictItemTypesPolicyOrgIds = restrictItemTypesPolicyOrgIds,
        )

    val allFilteredCipherViewList = filteredFailuresCipherViewList
        .plus(filteredCipherViewList)

    val folderList =
        (itemListingType as? VaultItemListingState.ItemListingType.Vault.Folder)
            ?.folderId
            ?.let { folderViewList.getFolders(it) }
            .orEmpty()

    val collectionList =
        (itemListingType as? VaultItemListingState.ItemListingType.Vault.Collection)
            ?.let { collectionViewList.getCollections(it.collectionId) }
            .orEmpty()

    // Nested collection counts cannot use the parent-scoped list, since ciphers in a nested
    // collection are not necessarily in the parent collection.
    val nestedCollectionCipherViewList = if (collectionList.isEmpty()) {
        emptyList()
    } else {
        decryptCipherListResult
            .successes
            .plus(failuresCipherViewList)
            .filter { it.isActive }
            .applyRestrictItemTypesPolicy(restrictItemTypesPolicyOrgIds)
            .toFilteredList(vaultFilterType)
    }

    return if (folderList.isNotEmpty() || allFilteredCipherViewList.isNotEmpty() ||
        collectionList.isNotEmpty()
    ) {
        VaultItemListingState.ViewState.Content(
            displayItemList = filteredFailuresCipherViewList
                .toDisplayItemListDecryptionError(isVfo1FoundationEnabled = isVfo1FoundationEnabled)
                .plus(
                    filteredCipherViewList.toDisplayItemList(
                        baseIconUrl = baseIconUrl,
                        hasMasterPassword = hasMasterPassword,
                        isIconLoadingDisabled = isIconLoadingDisabled,
                        isAutofill = autofillSelectionData != null,
                        isFido2Creation = createCredentialRequestData != null,
                        isPremiumUser = isPremiumUser,
                        isVfo1FoundationEnabled = isVfo1FoundationEnabled,
                    ),
                ),
            displayFolderList = folderList.map { folderView ->
                VaultItemListingState.FolderDisplayItem(
                    id = requireNotNull(folderView.id),
                    name = folderView.name,
                    count = decryptCipherListResult
                        .successes
                        .count {
                            it.deletedDate == null &&
                                !it.id.isNullOrBlank() &&
                                folderView.id == it.folderId
                        },
                )
            },
            displayCollectionList = collectionList.map { collectionView ->
                VaultItemListingState.CollectionDisplayItem(
                    id = requireNotNull(collectionView.id),
                    name = collectionView.name,
                    count = nestedCollectionCipherViewList
                        .count { collectionView.id in it.collectionIds },
                )
            },
        )
    } else {
        // Use the autofill empty message if necessary, otherwise use normal type-specific message
        val message = autofillSelectionData
            ?.uri
            ?.toHostOrPathOrNull()
            ?.let { VowkeyString.no_items_for_uri.asText(it) }
            ?: createCredentialRequestData
                ?.relyingPartyIdOrNull
                ?.toHostOrPathOrNull()
                ?.let { VowkeyString.no_items_for_uri.asText(it) }
            ?: totpData?.let { VowkeyString.search_for_a_login_or_add_a_new_login.asText() }
            ?: run {
                when (itemListingType) {
                    is VaultItemListingState.ItemListingType.Vault.Folder -> {
                        VowkeyString.no_items_folder
                    }

                    is VaultItemListingState.ItemListingType.Vault.Collection -> {
                        if (isVfo1FoundationEnabled) {
                            VowkeyString.there_are_no_items_in_this_shared_folder
                        } else {
                            VowkeyString.no_items_collection
                        }
                    }

                    VaultItemListingState.ItemListingType.Vault.Trash -> {
                        VowkeyString.no_items_trash
                    }

                    VaultItemListingState.ItemListingType.Vault.Card -> {
                        VowkeyString.no_cards
                    }

                    VaultItemListingState.ItemListingType.Vault.Identity -> {
                        VowkeyString.no_identities
                    }

                    VaultItemListingState.ItemListingType.Vault.Login -> {
                        VowkeyString.no_logins
                    }

                    VaultItemListingState.ItemListingType.Vault.SecureNote -> {
                        VowkeyString.no_notes
                    }

                    VaultItemListingState.ItemListingType.Vault.SshKey -> {
                        VowkeyString.no_ssh_keys
                    }

                    VaultItemListingState.ItemListingType.Vault.BankAccount -> {
                        VowkeyString.no_bank_accounts
                    }

                    VaultItemListingState.ItemListingType.Vault.License -> {
                        VowkeyString.no_licenses
                    }

                    VaultItemListingState.ItemListingType.Vault.Passport -> {
                        VowkeyString.no_passports
                    }

                    VaultItemListingState.ItemListingType.Vault.Archive -> {
                        VowkeyString.no_archives_message
                    }
                }
                    .asText()
            }

        val restrictItemTypePolicyEnabled = restrictItemTypesPolicyOrgIds.isNotEmpty() &&
            itemListingType == VaultItemListingState.ItemListingType.Vault.Card

        val shouldShowAddButton = !restrictItemTypePolicyEnabled && itemListingType.hasFab

        VaultItemListingState.ViewState.NoItems(
            header = totpData
                ?.let {
                    VowkeyString.no_items_for_vault
                        .asText(it.issuer ?: it.accountName ?: "--")
                }
                ?: run {
                    when (itemListingType) {
                        is VaultItemListingState.ItemListingType.Vault.Folder,
                        is VaultItemListingState.ItemListingType.Vault.Collection,
                        VaultItemListingState.ItemListingType.Vault.Trash,
                        VaultItemListingState.ItemListingType.Vault.Card,
                        VaultItemListingState.ItemListingType.Vault.Identity,
                        VaultItemListingState.ItemListingType.Vault.Login,
                        VaultItemListingState.ItemListingType.Vault.SecureNote,
                        VaultItemListingState.ItemListingType.Vault.SshKey,
                        VaultItemListingState.ItemListingType.Vault.BankAccount,
                        VaultItemListingState.ItemListingType.Vault.License,
                        VaultItemListingState.ItemListingType.Vault.Passport,
                            -> null

                        VaultItemListingState.ItemListingType.Vault.Archive -> {
                            VowkeyString.no_archives_title.asText()
                        }
                    }
                },
            message = message,
            shouldShowAddButton = shouldShowAddButton,
            buttonText = createCredentialRequestData
                ?.let { VowkeyString.save_passkey_as_new_login.asText() }
                ?: run {
                    when (itemListingType) {
                        VaultItemListingState.ItemListingType.Vault.Card -> {
                            VowkeyString.add_card
                        }

                        VaultItemListingState.ItemListingType.Vault.Identity -> {
                            VowkeyString.add_identity
                        }

                        VaultItemListingState.ItemListingType.Vault.Login -> {
                            VowkeyString.add_login
                        }

                        VaultItemListingState.ItemListingType.Vault.SecureNote -> {
                            VowkeyString.add_note
                        }

                        VaultItemListingState.ItemListingType.Vault.SshKey -> {
                            VowkeyString.add_ssh_key
                        }

                        VaultItemListingState.ItemListingType.Vault.BankAccount -> {
                            VowkeyString.add_bank_account
                        }

                        VaultItemListingState.ItemListingType.Vault.License -> {
                            VowkeyString.add_license
                        }

                        VaultItemListingState.ItemListingType.Vault.Passport -> {
                            VowkeyString.add_passport
                        }

                        else -> VowkeyString.add_item
                    }
                        .asText()
                },
            vectorRes = totpData
                ?.let { VowkeyDrawable.ill_folder_question }
                ?: run {
                    when (itemListingType) {
                        is VaultItemListingState.ItemListingType.Vault.Folder,
                        is VaultItemListingState.ItemListingType.Vault.Collection,
                        VaultItemListingState.ItemListingType.Vault.Trash,
                        VaultItemListingState.ItemListingType.Vault.Card,
                        VaultItemListingState.ItemListingType.Vault.Identity,
                        VaultItemListingState.ItemListingType.Vault.Login,
                        VaultItemListingState.ItemListingType.Vault.SecureNote,
                        VaultItemListingState.ItemListingType.Vault.SshKey,
                        VaultItemListingState.ItemListingType.Vault.BankAccount,
                        VaultItemListingState.ItemListingType.Vault.License,
                        VaultItemListingState.ItemListingType.Vault.Passport,
                            -> null

                        VaultItemListingState.ItemListingType.Vault.Archive -> {
                            VowkeyDrawable.ill_open_source
                        }
                    }
                },
        )
    }
}

/**
 * Transforms a list of [CipherView] into [VaultItemListingState.ViewState].
 */
fun List<SendView>.toViewState(
    itemListingType: VaultItemListingState.ItemListingType.Send,
    baseWebSendUrl: String,
    clock: Clock,
): VaultItemListingState.ViewState =
    if (isNotEmpty()) {
        VaultItemListingState.ViewState.Content(
            displayItemList = toDisplayItemList(
                baseWebSendUrl = baseWebSendUrl,
                clock = clock,
            ),
            displayFolderList = emptyList(),
            displayCollectionList = emptyList(),
        )
    } else {
        VaultItemListingState.ViewState.NoItems(
            message = when (itemListingType) {
                VaultItemListingState.ItemListingType.Send.SendFile -> VowkeyString.no_file_sends
                VaultItemListingState.ItemListingType.Send.SendText -> VowkeyString.no_text_sends
            }
                .asText(),
            shouldShowAddButton = true,
            buttonText = when (itemListingType) {
                VaultItemListingState.ItemListingType.Send.SendFile -> VowkeyString.new_file_send
                VaultItemListingState.ItemListingType.Send.SendText -> VowkeyString.new_text_send
            }
                .asText(),
        )
    }

/**
 * Updates a [VaultItemListingState.ItemListingType] with the given data if necessary.
 */
fun VaultItemListingState.ItemListingType.updateWithAdditionalDataIfNecessary(
    folderList: List<FolderView>,
    collectionList: List<CollectionView>,
): VaultItemListingState.ItemListingType =
    when (this) {
        is VaultItemListingState.ItemListingType.Vault.Card -> this
        is VaultItemListingState.ItemListingType.Vault.Collection -> copy(
            collectionName = collectionList
                .find { it.id == collectionId }
                ?.name
                ?.toCollectionDisplayName(collectionList)
                .orEmpty(),
        )

        is VaultItemListingState.ItemListingType.Vault.Folder -> {
            val fullyQualifiedName = folderList
                .find { it.id == folderId }
                ?.name
            copy(
                folderName = fullyQualifiedName
                    ?.toFolderDisplayName()
                    .orEmpty(),
                fullyQualifiedName = fullyQualifiedName.orEmpty(),
            )
        }

        is VaultItemListingState.ItemListingType.Vault.Identity -> this
        is VaultItemListingState.ItemListingType.Vault.Login -> this
        is VaultItemListingState.ItemListingType.Vault.SecureNote -> this
        is VaultItemListingState.ItemListingType.Vault.Trash -> this
        is VaultItemListingState.ItemListingType.Send.SendFile -> this
        is VaultItemListingState.ItemListingType.Send.SendText -> this
        is VaultItemListingState.ItemListingType.Vault.SshKey -> this
        is VaultItemListingState.ItemListingType.Vault.BankAccount -> this
        is VaultItemListingState.ItemListingType.Vault.License -> this
        is VaultItemListingState.ItemListingType.Vault.Passport -> this
        is VaultItemListingState.ItemListingType.Vault.Archive -> this
    }

@Suppress("LongParameterList")
private fun List<CipherListView>.toDisplayItemList(
    baseIconUrl: String,
    hasMasterPassword: Boolean,
    isIconLoadingDisabled: Boolean,
    isAutofill: Boolean,
    isFido2Creation: Boolean,
    isPremiumUser: Boolean,
    isVfo1FoundationEnabled: Boolean = false,
): List<VaultItemListingState.DisplayItem> =
    this.map {
        it.toDisplayItem(
            baseIconUrl = baseIconUrl,
            hasMasterPassword = hasMasterPassword,
            isIconLoadingDisabled = isIconLoadingDisabled,
            isAutofill = isAutofill,
            isFido2Creation = isFido2Creation,
            isPremiumUser = isPremiumUser,
            isVfo1FoundationEnabled = isVfo1FoundationEnabled,
        )
    }

private fun List<SendView>.toDisplayItemList(
    baseWebSendUrl: String,
    clock: Clock,
): List<VaultItemListingState.DisplayItem> =
    this.map {
        it.toDisplayItem(
            baseWebSendUrl = baseWebSendUrl,
            clock = clock,
        )
    }

@Suppress("LongParameterList")
private fun CipherListView.toDisplayItem(
    baseIconUrl: String,
    hasMasterPassword: Boolean,
    isIconLoadingDisabled: Boolean,
    isAutofill: Boolean,
    isFido2Creation: Boolean,
    isPremiumUser: Boolean,
    isVfo1FoundationEnabled: Boolean = false,
): VaultItemListingState.DisplayItem =
    VaultItemListingState.DisplayItem(
        id = id.orEmpty(),
        title = name.asText(),
        titleTestTag = "CipherNameLabel",
        secondSubtitle = this.toSecondSubtitle(
            fido2CredentialRpId = login?.fido2Credentials?.firstOrNull()?.rpId,
        ),
        secondSubtitleTestTag = "PasskeySite",
        subtitle = this.subtitle,
        subtitleTestTag = this.toSubtitleTestTag(
            isAutofill = isAutofill,
            isFido2Creation = isFido2Creation,
        ),
        iconData = this.toIconData(
            baseIconUrl = baseIconUrl,
            isIconLoadingDisabled = isIconLoadingDisabled,
            usePasskeyDefaultIcon = (isAutofill || isFido2Creation) &&
                this.isActiveWithFido2Credentials,
        ),
        iconTestTag = this.toIconTestTag(),
        extraIconList = this.toLabelIcons(isVfo1FoundationEnabled = isVfo1FoundationEnabled),
        overflowOptions = this.toOverflowActions(
            hasMasterPassword = hasMasterPassword,
            isPremiumUser = isPremiumUser,
        ),
        optionsTestTag = "CipherOptionsButton",
        isAutofill = isAutofill,
        isCredentialCreation = isFido2Creation,
        shouldShowMasterPasswordReprompt = (reprompt == CipherRepromptType.PASSWORD) &&
            hasMasterPassword,
        itemType = VaultItemListingState
            .DisplayItem
            .ItemType
            .Vault(
                type = this.type.toSdkCipherType(),
            ),
    )

@Suppress("MaxLineLength")
private fun List<CipherListView>.toDisplayItemListDecryptionError(
    isVfo1FoundationEnabled: Boolean = false,
): List<VaultItemListingState.DisplayItem> =
    this.map {
        it.toDisplayItemDecryptionError(isVfo1FoundationEnabled = isVfo1FoundationEnabled)
    }

private fun CipherListView.toDisplayItemDecryptionError(
    isVfo1FoundationEnabled: Boolean = false,
): VaultItemListingState.DisplayItem =
    VaultItemListingState.DisplayItem(
        id = id.orEmpty(),
        title = VowkeyString.error_cannot_decrypt.asText(),
        titleTestTag = "CipherNameLabel",
        secondSubtitle = null,
        secondSubtitleTestTag = null,
        subtitle = null,
        subtitleTestTag = "",
        iconData = IconData.Local(iconRes = VowkeyDrawable.ic_globe),
        iconTestTag = this.toIconTestTag(),
        extraIconList = this.toLabelIcons(isVfo1FoundationEnabled = isVfo1FoundationEnabled),
        overflowOptions = emptyList(),
        optionsTestTag = "CipherOptionsButton",
        isAutofill = false,
        isCredentialCreation = false,
        shouldShowMasterPasswordReprompt = false,
        itemType = VaultItemListingState.DisplayItem.ItemType.DecryptionError,
    )

private fun CipherListView.toSecondSubtitle(fido2CredentialRpId: String?): String? =
    fido2CredentialRpId
        ?.takeIf { this.type is CipherListViewType.Login && it.isNotEmpty() && it != this.name }

private fun CipherListView.toSubtitleTestTag(
    isAutofill: Boolean,
    isFido2Creation: Boolean,
): String =
    if ((isAutofill || isFido2Creation)) {
        if (this.isActiveWithFido2Credentials) "PasskeyName" else "PasswordName"
    } else {
        "CipherSubTitleLabel"
    }

private fun CipherListView.toIconTestTag(): String =
    when (type) {
        is CipherListViewType.Login -> "LoginCipherIcon"
        CipherListViewType.SecureNote -> "SecureNoteCipherIcon"
        is CipherListViewType.Card -> "CardCipherIcon"
        CipherListViewType.Identity -> "IdentityCipherIcon"
        CipherListViewType.SshKey -> "SshKeyCipherIcon"
        is CipherListViewType.BankAccount -> "BankAccountCipherIcon"
        CipherListViewType.DriversLicense -> "LicenseCipherIcon"
        CipherListViewType.Passport -> "PassportCipherIcon"
        CipherListViewType.ApiKey -> "KeyCipherIcon"
        CipherListViewType.Environment -> "EnvironmentCipherIcon"
    }

private fun CipherListView.toIconData(
    baseIconUrl: String,
    isIconLoadingDisabled: Boolean,
    usePasskeyDefaultIcon: Boolean,
): IconData {
    return when (this.type) {
        is CipherListViewType.Login -> {
            login?.uris.toLoginIconData(
                baseIconUrl = baseIconUrl,
                isIconLoadingDisabled = isIconLoadingDisabled,
                usePasskeyDefaultIcon = usePasskeyDefaultIcon,
            )
        }

        else -> {
            IconData.Local(iconRes = this.type.iconRes)
        }
    }
}

private fun SendView.toDisplayItem(
    baseWebSendUrl: String,
    clock: Clock,
): VaultItemListingState.DisplayItem =
    VaultItemListingState.DisplayItem(
        id = id.orEmpty(),
        title = name.asText(),
        titleTestTag = "SendNameLabel",
        secondSubtitle = null,
        secondSubtitleTestTag = null,
        subtitle = deletionDate.toFormattedDateTimeStyle(
            dateStyle = FormatStyle.MEDIUM,
            timeStyle = FormatStyle.SHORT,
            clock = clock,
        ),
        subtitleTestTag = "SendDateLabel",
        iconData = IconData.Local(
            iconRes = when (type) {
                SendType.TEXT -> VowkeyDrawable.ic_file_text
                SendType.FILE -> VowkeyDrawable.ic_file
                SendType.ITEM -> TODO("[PM-41095] Support Item SendType")
            },
        ),
        iconTestTag = null,
        extraIconList = toLabelIcons(clock = clock),
        overflowOptions = toOverflowActions(baseWebSendUrl = baseWebSendUrl),
        optionsTestTag = "SendOptionsButton",
        isAutofill = false,
        shouldShowMasterPasswordReprompt = false,
        isCredentialCreation = false,
        itemType = VaultItemListingState.DisplayItem.ItemType.Sends(type = this.type),
    )

@get:DrawableRes
private val CipherListViewType.iconRes: Int
    get() = when (this) {
        is CipherListViewType.Login -> VowkeyDrawable.ic_globe
        CipherListViewType.SecureNote -> VowkeyDrawable.ic_note
        is CipherListViewType.Card -> VowkeyDrawable.ic_payment_card
        CipherListViewType.Identity -> VowkeyDrawable.ic_id_card
        CipherListViewType.SshKey -> VowkeyDrawable.ic_ssh_key
        is CipherListViewType.BankAccount -> VowkeyDrawable.ic_payment_card
        CipherListViewType.DriversLicense -> VowkeyDrawable.ic_note
        CipherListViewType.Passport -> VowkeyDrawable.ic_passport
        CipherListViewType.ApiKey, CipherListViewType.Environment -> VowkeyDrawable.ic_ssh_key
    }

private fun List<CipherListView>.applyFilters(
    itemListingType: VaultItemListingState.ItemListingType.Vault,
    vaultFilterType: VaultFilterType,
    restrictItemTypesPolicyOrgIds: List<String>,
): List<CipherListView> = this
    .filter { it.determineListingPredicate(itemListingType) }
    .applyRestrictItemTypesPolicy(restrictItemTypesPolicyOrgIds)
    .toFilteredList(vaultFilterType)
