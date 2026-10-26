package com.vowkey.app.ui.platform.manager.resource

import android.content.Context
import androidx.annotation.StringRes
import com.vowkey.annotation.OmitFromCoverage

/**
 * Primary implementation of [ResourceManager].
 */
@OmitFromCoverage
class ResourceManagerImpl(private val context: Context) : ResourceManager {
    override fun getString(@StringRes resId: Int): String =
        context.getString(resId)

    override fun getString(@StringRes resId: Int, vararg formatArgs: Any): String =
        context.getString(resId, *formatArgs)
}
