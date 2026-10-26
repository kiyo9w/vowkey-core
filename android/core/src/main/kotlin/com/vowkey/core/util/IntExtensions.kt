package com.vowkey.core.util

import android.app.PendingIntent
import android.os.Build
import com.vowkey.annotation.OmitFromCoverage

/**
 * Starting from an initial pending intent flag. (ex: [PendingIntent.FLAG_CANCEL_CURRENT])
 */
@OmitFromCoverage
fun Int.toPendingIntentMutabilityFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        this or PendingIntent.FLAG_MUTABLE
    } else {
        this
    }
