package com.vowkey.app.data.vault.repository.model

import com.vowkey.send.SendView

/**
 * Represents decrypted send data.
 *
 * @param sendViewList List of decrypted sends.
 */
data class SendData(
    val sendViewList: List<SendView>,
)
