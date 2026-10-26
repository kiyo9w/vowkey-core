package com.vowkey.app.ui.vault.util

import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.model.VaultBankAccountType
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

class VaultBankAccountTypeExtensionsTest {

    @Test
    fun `longName should return the correct value for each VaultBankAccountType`() {
        mapOf(
            VaultBankAccountType.SELECT to VowkeyString.select.asText(),
            VaultBankAccountType.CHECKING to VowkeyString.checking.asText(),
            VaultBankAccountType.SAVINGS to VowkeyString.savings.asText(),
            VaultBankAccountType.CERTIFICATE_OF_DEPOSIT to
                VowkeyString.certificate_of_deposit.asText(),
            VaultBankAccountType.LINE_OF_CREDIT to VowkeyString.line_of_credit.asText(),
            VaultBankAccountType.INVESTMENT_BROKERAGE to
                VowkeyString.investment_brokerage.asText(),
            VaultBankAccountType.MONEY_MARKET to VowkeyString.money_market.asText(),
            VaultBankAccountType.OTHER to VowkeyString.other.asText(),
        )
            .forEach { (type, label) ->
                assertEquals(label, type.longName)
            }
    }
}
