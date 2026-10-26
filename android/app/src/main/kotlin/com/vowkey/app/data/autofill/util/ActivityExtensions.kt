@file:OmitFromCoverage

package com.vowkey.app.data.autofill.util

import android.app.Activity
import android.os.Build
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.app.data.autofill.model.AutofillAppInfo

/**
 * Build an [AutofillAppInfo] from the given [Activity].
 */
fun Activity.toAutofillAppInfo(): AutofillAppInfo =
    AutofillAppInfo(
        context = this.applicationContext,
        packageName = this.packageName,
        sdkInt = Build.VERSION.SDK_INT,
    )
