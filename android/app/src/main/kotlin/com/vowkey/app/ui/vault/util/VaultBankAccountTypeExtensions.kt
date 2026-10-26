package com.vowkey.app.ui.vault.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.model.VaultBankAccountType

/**
 * Helper that exposes the display name [Text] for a [VaultBankAccountType].
 */
val VaultBankAccountType.longName: Text
    get() = when (this) {
        VaultBankAccountType.SELECT -> VowkeyString.select.asText()
        VaultBankAccountType.CHECKING -> VowkeyString.checking.asText()
        VaultBankAccountType.SAVINGS -> VowkeyString.savings.asText()
        VaultBankAccountType.CERTIFICATE_OF_DEPOSIT -> {
            VowkeyString.certificate_of_deposit.asText()
        }

        VaultBankAccountType.LINE_OF_CREDIT -> VowkeyString.line_of_credit.asText()
        VaultBankAccountType.INVESTMENT_BROKERAGE -> {
            VowkeyString.investment_brokerage.asText()
        }

        VaultBankAccountType.MONEY_MARKET -> VowkeyString.money_market.asText()
        VaultBankAccountType.OTHER -> VowkeyString.other.asText()
    }
