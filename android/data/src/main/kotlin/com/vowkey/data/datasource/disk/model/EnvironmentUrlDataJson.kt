package com.vowkey.data.datasource.disk.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * Represents URLs for various Vowkey domains.
 *
 * @property base The overall base URL.
 * @property keyUri A Uri containing the alias and host of the key used for mutual TLS.
 * @property api Separate base URL for the "/api" domain (if applicable).
 * @property identity Separate base URL for the "/identity" domain (if applicable).
 * @property icon Separate base URL for the icon domain (if applicable).
 * @property notifications Separate base URL for the notifications domain (if applicable).
 * @property webVault Separate base URL for the web vault domain (if applicable).
 * @property events Separate base URL for the events domain (if applicable).
 */
@Serializable
data class EnvironmentUrlDataJson(
    @SerialName("base")
    val base: String,

    @SerialName("keyUri")
    val keyUri: String? = null,

    @SerialName("api")
    val api: String? = null,

    @SerialName("identity")
    val identity: String? = null,

    @SerialName("icons")
    val icon: String? = null,

    @SerialName("notifications")
    val notifications: String? = null,

    @SerialName("webVault")
    val webVault: String? = null,

    @SerialName("events")
    val events: String? = null,
) {
    /**
     * Indicates if this is a FedRamp environment.
     */
    val isFedRamp: Boolean
        get() = base.contains(other = VOWKEY_FED_RAMP_DEV_BASE_URL) ||
            base.contains(other = GAME_WARDEN_FED_RAMP_DEV_BASE_URL) ||
            base.contains(other = GAME_WARDEN_FED_RAMP_STAGING_BASE_URL) ||
            base.contains(other = VOWKEY_FED_RAMP_PROD_DOMAIN)

    /**
     * Indicates if this is an internal environment.
     */
    val isInternal: Boolean get() = base.contains(other = VOWKEY_INTERNAL_DOMAIN)

    @Suppress("UndocumentedPublicClass")
    companion object {
        /**
         * The domain used for internal Vowkey environments.
         */
        private const val VOWKEY_INTERNAL_DOMAIN: String = "vowkey.pw"

        /**
         * The domain used for production Vowkey FedRAMP Vowkey environments.
         */
        private const val VOWKEY_FED_RAMP_PROD_DOMAIN: String = "bitwarden-gov.com"

        /**
         * The base URL used for the Vowkey FedRAMP development environments.
         */
        private const val VOWKEY_FED_RAMP_DEV_BASE_URL: String =
            "vault.fedramp.usdev.vowkey.pw"

        /**
         * The base URL used for the Game Warden FedRAMP development environments.
         */
        private const val GAME_WARDEN_FED_RAMP_DEV_BASE_URL: String = "gw.dev.vowkey.pw"

        /**
         * The base URL used for the Game Warden FedRAMP staging environments.
         */
        private const val GAME_WARDEN_FED_RAMP_STAGING_BASE_URL: String = "gw.stg.vowkey.pw"

        /**
         * Default [EnvironmentUrlDataJson] for the US region.
         */
        val DEFAULT_US: EnvironmentUrlDataJson =
            EnvironmentUrlDataJson(base = "https://vault.vowkey.app")

        /**
         * Default [EnvironmentUrlDataJson] for the US region as written to disk by the legacy
         * Xamarin app.
         */
        val DEFAULT_LEGACY_US: EnvironmentUrlDataJson = EnvironmentUrlDataJson(
            base = "https://vault.vowkey.app",
            keyUri = null,
            api = "https://api.vowkey.app",
            identity = "https://identity.vowkey.app",
            icon = "https://icons.vowkey.app",
            notifications = "https://notifications.vowkey.app",
            webVault = "https://vault.vowkey.app",
            events = "https://events.vowkey.app",
        )

        /**
         * Default [EnvironmentUrlDataJson] for the EU region.
         */
        val DEFAULT_EU: EnvironmentUrlDataJson =
            EnvironmentUrlDataJson(base = "https://vault.vowkey.app")

        /**
         * Default [EnvironmentUrlDataJson] for the EU region as written to disk by the legacy
         * Xamarin app.
         */
        val DEFAULT_LEGACY_EU: EnvironmentUrlDataJson = EnvironmentUrlDataJson(
            base = "https://vault.vowkey.app",
            keyUri = null,
            api = "https://api.vowkey.app",
            identity = "https://identity.vowkey.app",
            icon = "https://icons.vowkey.app",
            notifications = "https://notifications.vowkey.app",
            webVault = "https://vault.vowkey.app",
            events = "https://events.vowkey.app",
        )

        /**
         * Default [EnvironmentUrlDataJson] for the FedRAMP environment.
         */
        val DEFAULT_FED_RAMP: EnvironmentUrlDataJson =
            EnvironmentUrlDataJson(base = "https://vault.bitwarden-gov.com")
    }
}
