package com.vowkey.app.ui.platform.feature.premium.plan.util

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.platform.theme.color.VowkeyColorScheme
import com.vowkey.app.data.billing.repository.model.PremiumSubscriptionStatus

/**
 * Returns the localized label string resource for a [PremiumSubscriptionStatus].
 */
@StringRes
fun PremiumSubscriptionStatus.labelRes(): Int = when (this) {
    PremiumSubscriptionStatus.ACTIVE -> VowkeyString.subscription_status_active
    PremiumSubscriptionStatus.CANCELED -> VowkeyString.subscription_status_canceled
    PremiumSubscriptionStatus.EXPIRED -> VowkeyString.subscription_status_expired
    PremiumSubscriptionStatus.PENDING_CANCELLATION -> {
        VowkeyString.subscription_status_pending_cancellation
    }

    PremiumSubscriptionStatus.PAST_DUE -> VowkeyString.subscription_status_past_due
    PremiumSubscriptionStatus.PAUSED -> VowkeyString.subscription_status_paused
    PremiumSubscriptionStatus.UNPAID -> VowkeyString.subscription_status_unpaid
    PremiumSubscriptionStatus.UPDATE_PAYMENT -> VowkeyString.subscription_status_update_payment
}

/**
 * Returns `true` when the Premium plan card should replace its billing line items with the
 * premium feature list. Reserved for terminal states where line items carry no actionable
 * information and the user's path forward is to resubscribe.
 */
fun PremiumSubscriptionStatus.showsFeatureList(): Boolean = when (this) {
    PremiumSubscriptionStatus.CANCELED,
    PremiumSubscriptionStatus.EXPIRED,
        -> true

    PremiumSubscriptionStatus.ACTIVE,
    PremiumSubscriptionStatus.PAST_DUE,
    PremiumSubscriptionStatus.PAUSED,
    PremiumSubscriptionStatus.PENDING_CANCELLATION,
    PremiumSubscriptionStatus.UNPAID,
    PremiumSubscriptionStatus.UPDATE_PAYMENT,
        -> false
}

/**
 * Returns the [VowkeyColorScheme.StatusBadgeVariantColors] used to render the badge for a
 * [PremiumSubscriptionStatus].
 */
@Composable
fun PremiumSubscriptionStatus.badgeColors(): VowkeyColorScheme.StatusBadgeVariantColors =
    when (this) {
        PremiumSubscriptionStatus.ACTIVE -> VowkeyTheme.colorScheme.statusBadge.success
        PremiumSubscriptionStatus.CANCELED,
        PremiumSubscriptionStatus.EXPIRED,
        PremiumSubscriptionStatus.UNPAID,
            -> VowkeyTheme.colorScheme.statusBadge.error

        PremiumSubscriptionStatus.PAST_DUE,
        PremiumSubscriptionStatus.PAUSED,
        PremiumSubscriptionStatus.PENDING_CANCELLATION,
        PremiumSubscriptionStatus.UPDATE_PAYMENT,
            -> VowkeyTheme.colorScheme.statusBadge.warning
    }
