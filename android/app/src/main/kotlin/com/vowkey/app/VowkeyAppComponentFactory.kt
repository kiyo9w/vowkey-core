package com.vowkey.app

import android.app.Service
import android.content.Intent
import android.os.Build
import androidx.annotation.Keep
import androidx.core.app.AppComponentFactory
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.app.data.autofill.VowkeyAutofillService
import com.vowkey.app.data.autofill.accessibility.VowkeyAccessibilityService
import com.vowkey.app.data.credentials.VowkeyCredentialProviderService
import com.vowkey.app.data.tiles.VowkeyAutofillTileService
import com.vowkey.app.data.tiles.VowkeyGeneratorTileService
import com.vowkey.app.data.tiles.VowkeyVaultTileService

/**
 * A factory class that allows us to intercept when a manifest element is being instantiated
 * and modify various characteristics before initialization.
 */
@Suppress("unused")
@Keep
@OmitFromCoverage
class VowkeyAppComponentFactory : AppComponentFactory() {
    /**
     * Used to intercept when certain legacy services are being instantiated and modify which
     * service is created. This is required because the [className] used in the manifest must match
     * the legacy Xamarin app service name but the service name in this app is different.
     *
     * Services currently being managed:
     * * [VowkeyAccessibilityService]
     * * [VowkeyAutofillService]
     * * [VowkeyAutofillTileService]
     * * [VowkeyCredentialProviderService]
     * * [VowkeyVaultTileService]
     * * [VowkeyGeneratorTileService]
     */
    override fun instantiateServiceCompat(
        cl: ClassLoader,
        className: String,
        intent: Intent?,
    ): Service = when (className) {
        LEGACY_ACCESSIBILITY_SERVICE_NAME -> {
            super.instantiateServiceCompat(
                cl,
                VowkeyAccessibilityService::class.java.name,
                intent,
            )
        }

        LEGACY_AUTOFILL_SERVICE_NAME -> {
            super.instantiateServiceCompat(cl, VowkeyAutofillService::class.java.name, intent)
        }

        LEGACY_AUTOFILL_TILE_SERVICE_NAME -> {
            super.instantiateServiceCompat(
                cl,
                VowkeyAutofillTileService::class.java.name,
                intent,
            )
        }

        LEGACY_CREDENTIAL_SERVICE_NAME -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                super.instantiateServiceCompat(
                    cl,
                    VowkeyCredentialProviderService::class.java.name,
                    intent,
                )
            } else {
                throw UnsupportedOperationException(
                    "The CredentialProviderService requires API 34 or higher.",
                )
            }
        }

        LEGACY_VAULT_TILE_SERVICE_NAME -> {
            super.instantiateServiceCompat(cl, VowkeyVaultTileService::class.java.name, intent)
        }

        LEGACY_GENERATOR_TILE_SERVICE_NAME -> {
            super.instantiateServiceCompat(
                cl,
                VowkeyGeneratorTileService::class.java.name,
                intent,
            )
        }

        else -> super.instantiateServiceCompat(cl, className, intent)
    }
}
