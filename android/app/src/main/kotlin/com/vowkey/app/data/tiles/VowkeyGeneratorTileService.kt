package com.vowkey.app.data.tiles

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.TileService
import androidx.annotation.Keep
import androidx.core.net.toUri
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.core.util.isBuildVersionAtLeast
import com.vowkey.app.MainActivity

/**
 * A service for handling the Password Generator quick settings tile.
 */
@Keep
@OmitFromCoverage
class VowkeyGeneratorTileService : TileService() {

    override fun onClick() {
        if (isLocked) {
            unlockAndRun { launchGenerator() }
        } else {
            launchGenerator()
        }
    }

    private fun launchGenerator() {
        val intent = Intent(applicationContext, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            .setData("vowkey://password_generator".toUri())
        if (!isBuildVersionAtLeast(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)) {
            @Suppress("DEPRECATION")
            @SuppressLint("StartActivityAndCollapseDeprecated")
            startActivityAndCollapse(intent)
        } else {
            startActivityAndCollapse(
                PendingIntent.getActivity(
                    this,
                    0,
                    intent,
                    PendingIntent.FLAG_IMMUTABLE,
                ),
            )
        }
    }
}
