package com.vowkey.core.data.manager.realtime

import android.os.SystemClock
import com.vowkey.annotation.OmitFromCoverage

/**
 * The default implementation of the [RealtimeManager].
 */
@OmitFromCoverage
class RealtimeManagerImpl : RealtimeManager {
    override val elapsedRealtimeMs: Long get() = SystemClock.elapsedRealtime()
}
