package com.vowkey.app.data.autofill.manager

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.vault.CipherView
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.platform.manager.clipboard.VowkeyClipboardManager
import com.vowkey.app.data.platform.repository.SettingsRepository
import com.vowkey.app.data.vault.repository.VaultRepository
import com.vowkey.app.data.vault.repository.model.GenerateTotpResult
import java.time.Clock

/**
 * Default implementation of the [AutofillTotpManager].
 */
class AutofillTotpManagerImpl(
    private val clock: Clock,
    private val clipboardManager: VowkeyClipboardManager,
    private val authRepository: AuthRepository,
    private val settingsRepository: SettingsRepository,
    private val vaultRepository: VaultRepository,
) : AutofillTotpManager {
    override suspend fun tryCopyTotpToClipboard(cipherView: CipherView) {
        if (settingsRepository.isAutoCopyTotpDisabled) return
        val isPremium = authRepository.userStateFlow.value?.activeAccount?.isPremium == true
        if (!isPremium && !cipherView.organizationUseTotp) return
        cipherView.login?.totp ?: return
        val cipherId = cipherView.id ?: return

        val totpResult = vaultRepository.generateTotp(
            time = clock.instant(),
            cipherId = cipherId,
        )

        if (totpResult is GenerateTotpResult.Success) {
            clipboardManager.setText(
                text = totpResult.code,
                toastDescriptorOverride = VowkeyString.verification_code_totp.asText(),
            )
        }
    }
}
