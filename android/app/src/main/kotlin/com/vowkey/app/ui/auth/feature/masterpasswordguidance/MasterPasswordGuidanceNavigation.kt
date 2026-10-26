package com.vowkey.app.ui.auth.feature.masterpasswordguidance

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import com.vowkey.ui.platform.base.util.composableWithSlideTransitions
import kotlinx.serialization.Serializable

/**
 * The type-safe route for the master password guidance screen.
 */
@Serializable
data object MasterPasswordGuidanceRoute

/**
 * Navigate to the master password guidance screen.
 */
fun NavController.navigateToMasterPasswordGuidance(navOptions: NavOptions? = null) {
    this.navigate(route = MasterPasswordGuidanceRoute, navOptions = navOptions)
}

/**
 * Add the master password guidance screen to the nav graph.
 */
fun NavGraphBuilder.masterPasswordGuidanceDestination(
    onNavigateBack: () -> Unit,
    onNavigateToGeneratePassword: () -> Unit,
) {
    composableWithSlideTransitions<MasterPasswordGuidanceRoute> {
        MasterPasswordGuidanceScreen(
            onNavigateBack = onNavigateBack,
            onNavigateToGeneratePassword = onNavigateToGeneratePassword,
        )
    }
}
