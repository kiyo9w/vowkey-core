@file:OmitFromCoverage

package com.vowkey.app.ui.platform.feature.premium.upgraded

import android.os.Parcelable
import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.toRoute
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.base.util.composableWithSlideTransitions
import com.vowkey.ui.platform.util.ParcelableRouteSerializer
import com.vowkey.app.ui.platform.feature.premium.plan.PlanMode
import kotlinx.parcelize.Parcelize
import kotlinx.serialization.Serializable

/**
 * The type-safe route for the "Upgraded to Premium" screen. The [planMode] encodes how the user
 * reached the originating Plan screen and drives the dismiss semantics at the nav root.
 */
@OmitFromCoverage
@Parcelize
@Serializable(with = UpgradedToPremiumRoute.Serializer::class)
data class UpgradedToPremiumRoute(val planMode: PlanMode) : Parcelable {

    /**
     * Custom serializer to support the parameterized route.
     */
    class Serializer : ParcelableRouteSerializer<UpgradedToPremiumRoute>(
        UpgradedToPremiumRoute::class,
    )
}

/**
 * Add the "Upgraded to Premium" screen to the nav graph. The dismiss callback receives the
 * originating [PlanMode] so the registrant can choose appropriate pop semantics (e.g., pop only
 * the Upgraded to Premium screen vs. pop it and the modal Plan screen together).
 */
fun NavGraphBuilder.upgradedToPremiumDestination(
    onDismiss: (PlanMode) -> Unit,
) {
    composableWithSlideTransitions<UpgradedToPremiumRoute> { entry ->
        val route = entry.toRoute<UpgradedToPremiumRoute>()
        UpgradedToPremiumScreen(onDismiss = { onDismiss(route.planMode) })
    }
}

/**
 * Navigate to the "Upgraded to Premium" screen for the given [planMode].
 */
fun NavController.navigateToUpgradedToPremium(planMode: PlanMode) {
    this.navigate(route = UpgradedToPremiumRoute(planMode = planMode)) {
        launchSingleTop = true
    }
}
