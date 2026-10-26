package com.vowkey.app.ui.auth.feature.vaultunlock.util

import androidx.compose.ui.text.input.KeyboardType
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.model.VaultUnlockType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class VaultUnlockTypeExtensionsTest {
    @Test
    fun `unlockScreenTitle should return the correct title for each type`() {
        mapOf(
            VaultUnlockType.MASTER_PASSWORD to VowkeyString.verify_master_password.asText(),
            VaultUnlockType.PIN to VowkeyString.verify_pin.asText(),
        )
            .forEach { (type, expected) ->
                assertEquals(
                    expected,
                    type.unlockScreenTitle,
                )
            }
    }

    @Test
    fun `unlockScreenMessage should return the correct title for each type`() {
        mapOf(
            VaultUnlockType.MASTER_PASSWORD to
                VowkeyString.vault_locked_master_password.asText(),
            VaultUnlockType.PIN to VowkeyString.vault_locked_pin.asText(),
        )
            .forEach { (type, expected) ->
                assertEquals(
                    expected,
                    type.unlockScreenMessage,
                )
            }
    }

    @Test
    fun `unlockScreenInputLabel should return the correct title for each type`() {
        mapOf(
            VaultUnlockType.MASTER_PASSWORD to VowkeyString.master_password.asText(),
            VaultUnlockType.PIN to VowkeyString.pin.asText(),
        )
            .forEach { (type, expected) ->
                assertEquals(
                    expected,
                    type.unlockScreenInputLabel,
                )
            }
    }

    @Test
    fun `unlockScreenErrorMessage should return the correct title for each type`() {
        mapOf(
            VaultUnlockType.MASTER_PASSWORD to VowkeyString.invalid_master_password.asText(),
            VaultUnlockType.PIN to VowkeyString.invalid_pin.asText(),
        )
            .forEach { (type, expected) ->
                assertEquals(
                    expected,
                    type.unlockScreenErrorMessage,
                )
            }
    }

    @Test
    fun `unlockScreenKeyboardType should return the correct title for each type`() {
        mapOf(
            VaultUnlockType.MASTER_PASSWORD to KeyboardType.Password,
            VaultUnlockType.PIN to KeyboardType.Number,
        )
            .forEach { (type, expected) ->
                assertEquals(
                    expected,
                    type.unlockScreenKeyboardType,
                )
            }
    }

    @Test
    fun `emptyInputDialogMessage should return the correct title for each type`() {
        mapOf(
            VaultUnlockType.MASTER_PASSWORD to VowkeyString.validation_field_required.asText(
                VowkeyString.master_password.asText(),
            ),
            VaultUnlockType.PIN to
                VowkeyString.validation_field_required.asText(VowkeyString.pin.asText()),
        )
            .forEach { (type, expected) ->
                assertEquals(
                    expected,
                    type.emptyInputDialogMessage,
                )
            }
    }
}
