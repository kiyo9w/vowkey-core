@file:OmitFromCoverage

package com.vowkey.app.ui.platform.manager.utils

import android.content.Intent
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.app.data.autofill.model.browser.BrowserPackage

/**
 * Starts the browser autofill settings activity for the provided [browserPackage].
 */
fun IntentManager.startBrowserAutofillSettingsActivity(
    browserPackage: BrowserPackage,
): Boolean {
    val intent = Intent(Intent.ACTION_APPLICATION_PREFERENCES)
        .apply {
            addCategory(Intent.CATEGORY_DEFAULT)
            addCategory(Intent.CATEGORY_APP_BROWSER)
            addCategory(Intent.CATEGORY_PREFERENCE)
            setPackage(browserPackage.packageName)
        }
    return startActivity(intent)
}
