@file:OmitFromCoverage

package com.vowkey.testharness.ui.platform.feature.getpassword

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.base.util.composableWithPushTransitions
import kotlinx.serialization.Serializable

/**
 * Get password test screen.
 */
@Serializable
data object GetPasswordRoute

/**
 * Add Get Password destination to the nav graph.
 */
fun NavGraphBuilder.getPasswordDestination(
    onNavigateBack: () -> Unit,
) {
    composableWithPushTransitions<GetPasswordRoute> {
        GetPasswordScreen(
            onNavigateBack = onNavigateBack,
        )
    }
}

/**
 * Navigate to the Get Password test screen.
 */
fun NavController.navigateToGetPassword(navOptions: NavOptions? = null) {
    navigate(route = GetPasswordRoute, navOptions = navOptions)
}
