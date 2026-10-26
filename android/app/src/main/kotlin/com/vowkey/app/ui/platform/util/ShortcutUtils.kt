package com.vowkey.app.ui.platform.util

import android.content.Intent

/**
 * Returns `true` if the [Intent] is a deeplink to the vault, `false` otherwise.
 */
val Intent.isMyVaultShortcut: Boolean
    get() = dataString?.equals("vowkey://my_vault") == true

/**
 * Returns `true` if the [Intent] is a deeplink to the password generator, `false` otherwise.
 */
val Intent.isPasswordGeneratorShortcut: Boolean
    get() = dataString?.equals("vowkey://password_generator") == true

/**
 * Returns `true` if the [Intent] is a deeplink to the account security screen, `false` otherwise.
 */
val Intent.isAccountSecurityShortcut: Boolean
    get() = dataString?.equals("vowkey://settings/account_security") == true

/**
 * Returns `true` if the [Intent] is a deep link callback from a Premium
 * checkout session, `false` otherwise.
 */
val Intent.isPremiumCheckoutCallback: Boolean
    get() = dataString?.startsWith("vowkey://premium-checkout-result") == true
