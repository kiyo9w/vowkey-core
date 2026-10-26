@file:OmitFromCoverage

package com.vowkey.app.ui.vault.feature.itemlisting.model

import android.os.Parcelable
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.send.SendType
import com.vowkey.ui.platform.components.dialog.model.VowkeyTwoButtonDialogData
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.vault.CipherType
import kotlinx.parcelize.Parcelize

/**
 * Represents the actions for an individual item's overflow menu.
 */
sealed class ListingItemOverflowAction : Parcelable {

    /**
     * The display title of the option.
     */
    abstract val title: Text

    /**
     * The content description of the option.
     */
    abstract val contentDescription: Text

    /**
     * The data to be displayed for an optional speed bump dialog.
     */
    abstract val speedBump: VowkeyTwoButtonDialogData?

    /**
     * Represents the send actions.
     */
    sealed class SendAction : ListingItemOverflowAction() {
        /**
         * Click on the view send overflow option.
         */
        @Parcelize
        data class ViewClick(
            val sendId: String,
            val sendType: SendType,
        ) : SendAction() {
            override val title: Text get() = VowkeyString.view.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the edit send overflow option.
         */
        @Parcelize
        data class EditClick(
            val sendId: String,
            val sendType: SendType,
        ) : SendAction() {
            override val title: Text get() = VowkeyString.edit.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy send URL overflow option.
         */
        @Parcelize
        data class CopyUrlClick(val sendUrl: String) : SendAction() {
            override val title: Text get() = VowkeyString.copy_link.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the share send URL overflow option.
         */
        @Parcelize
        data class ShareUrlClick(val sendUrl: String) : SendAction() {
            override val title: Text get() = VowkeyString.share_link.asText()
            override val contentDescription: Text
                get() = VowkeyString.external_link_format.asText(title)
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the remove password send overflow option.
         */
        @Parcelize
        data class RemovePasswordClick(val sendId: String) : SendAction() {
            override val title: Text get() = VowkeyString.remove_password.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the delete send overflow option.
         */
        @Parcelize
        data class DeleteClick(val sendId: String) : SendAction() {
            override val title: Text get() = VowkeyString.delete.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData
                get() = VowkeyTwoButtonDialogData(
                    title = VowkeyString.delete.asText(),
                    message = VowkeyString.are_you_sure_delete_send.asText(),
                    confirmButtonText = VowkeyString.yes.asText(),
                    dismissButtonText = VowkeyString.cancel.asText(),
                )
        }
    }

    /**
     * Represents the vault actions.
     */
    sealed class VaultAction : ListingItemOverflowAction() {
        /**
         * Whether the action requires a master password re-prompt if that
         * setting is enabled for the selected item.
         */
        abstract val requiresPasswordReprompt: Boolean

        /**
         * Click on the view cipher overflow option.
         */
        @Parcelize
        data class ViewClick(
            val cipherId: String,
            val cipherType: CipherType,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.view.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the edit cipher overflow option.
         */
        @Parcelize
        data class EditClick(
            val cipherId: String,
            val cipherType: CipherType,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.edit.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy username overflow option.
         */
        @Parcelize
        data class CopyUsernameClick(val username: String) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_username.asText()
            override val requiresPasswordReprompt: Boolean get() = false
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy password overflow option.
         */
        @Parcelize
        data class CopyPasswordClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_password.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy TOTP code overflow option.
         */
        @Parcelize
        data class CopyTotpClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_totp.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy number overflow option.
         */
        @Parcelize
        data class CopyNumberClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_number.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy security code overflow option.
         */
        @Parcelize
        data class CopySecurityCodeClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_security_code.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy bank account number overflow option.
         */
        @Parcelize
        data class CopyAccountNumberClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_account_number.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy bank routing number overflow option.
         */
        @Parcelize
        data class CopyRoutingNumberClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_routing_number.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy license number overflow option.
         */
        @Parcelize
        data class CopyLicenseNumberClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_license_number.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy passport number overflow option.
         */
        @Parcelize
        data class CopyPassportNumberClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_passport_number.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the copy secure note overflow option.
         */
        @Parcelize
        data class CopyNoteClick(
            val cipherId: String,
            override val requiresPasswordReprompt: Boolean,
        ) : VaultAction() {
            override val title: Text get() = VowkeyString.copy_notes.asText()
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the launch overflow option.
         */
        @Parcelize
        data class LaunchClick(val url: String) : VaultAction() {
            override val title: Text get() = VowkeyString.launch.asText()
            override val requiresPasswordReprompt: Boolean get() = false
            override val contentDescription: Text
                get() = VowkeyString.external_link_format.asText(title)
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }

        /**
         * Click on the archive overflow option.
         */
        @Parcelize
        data class ArchiveClick(val cipherId: String) : VaultAction() {
            override val title: Text get() = VowkeyString.archive_verb.asText()
            override val requiresPasswordReprompt: Boolean get() = true
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData
                get() = VowkeyTwoButtonDialogData(
                    title = VowkeyString.archive_item.asText(),
                    message = VowkeyString.once_archived_this_item_will_be_excluded.asText(),
                    confirmButtonText = VowkeyString.archive_verb.asText(),
                    dismissButtonText = VowkeyString.cancel.asText(),
                )
        }

        /**
         * Click on the unarchive overflow option.
         */
        @Parcelize
        data class UnarchiveClick(val cipherId: String) : VaultAction() {
            override val title: Text get() = VowkeyString.unarchive.asText()
            override val requiresPasswordReprompt: Boolean get() = true
            override val contentDescription: Text get() = title
            override val speedBump: VowkeyTwoButtonDialogData? get() = null
        }
    }
}
