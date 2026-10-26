package com.vowkey.app.ui.vault.feature.verificationcode

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavOptions
import com.vowkey.ui.platform.base.util.composableWithPushTransitions
import com.vowkey.app.ui.vault.feature.item.VaultItemArgs
import kotlinx.serialization.Serializable

/**
 * The type-safe route for the verification code screen.
 */
@Serializable
data object VerificationCodeRoute

/**
 * Add the verification code screen to the nav graph.
 */
fun NavGraphBuilder.vaultVerificationCodeDestination(
    onNavigateBack: () -> Unit,
    onNavigateToSearchVault: () -> Unit,
    onNavigateToVaultItemScreen: (args: VaultItemArgs) -> Unit,
) {
    composableWithPushTransitions<VerificationCodeRoute> {
        VerificationCodeScreen(
            onNavigateToVaultItemScreen = onNavigateToVaultItemScreen,
            onNavigateToSearch = onNavigateToSearchVault,
            onNavigateBack = onNavigateBack,
        )
    }
}

/**
 * Navigate to the verification code screen.
 */
fun NavController.navigateToVerificationCodeScreen(
    navOptions: NavOptions? = null,
) {
    this.navigate(route = VerificationCodeRoute, navOptions = navOptions)
}
