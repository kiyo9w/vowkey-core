package com.vowkey.app.ui.platform.feature.overlaynav

import androidx.compose.runtime.Composable
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.app.ui.platform.components.util.rememberVowkeyNavController
import com.vowkey.app.ui.platform.feature.accessibilitydisclosure.accessibilityDisclosureDestination
import com.vowkey.app.ui.platform.feature.accessibilitydisclosure.navigateToAccessibilityDisclosure
import com.vowkey.app.ui.platform.feature.biometrics.navigateToUpdateBiometrics
import com.vowkey.app.ui.platform.feature.biometrics.updateBiometricsDestination
import com.vowkey.app.ui.platform.feature.cookieacquisition.cookieAcquisitionDestination
import com.vowkey.app.ui.platform.feature.cookieacquisition.navigateToCookieAcquisition
import com.vowkey.app.ui.platform.feature.localnetworkaccess.localNetworkAccessDestination
import com.vowkey.app.ui.platform.feature.localnetworkaccess.navigateToLocalNetworkAccess
import com.vowkey.app.ui.platform.feature.rootnav.RootNavigationRoute
import com.vowkey.app.ui.platform.feature.rootnav.rootNavDestination

/**
 * Controls the overlay [NavHost] for the app including the [rootNavDestination] and any screen
 * that can appear on top of it without affecting its state.
 */
@Composable
fun OverlayNavScreen(
    viewModel: OverlayNavViewModel = hiltViewModel(),
    navController: NavHostController = rememberVowkeyNavController(name = "OverlayNavScreen"),
    onSplashScreenRemoved: () -> Unit,
) {
    OverlayNavEventsEffect(
        viewModel = viewModel,
        navController = navController,
    )
    NavHost(
        navController = navController,
        startDestination = RootNavigationRoute,
    ) {
        // This is the overlay level of navigation that sits above the root nav. These screens
        // can appear on top of the rest of the app without interacting with the state-based
        // navigation used by RootNavScreen (which also exists here).
        rootNavDestination(onSplashScreenRemoved = onSplashScreenRemoved)
        cookieAcquisitionDestination(
            onDismiss = { navController.popBackStack() },
            onSplashScreenRemoved = onSplashScreenRemoved,
        )
        localNetworkAccessDestination(
            onDismiss = { navController.popBackStack() },
            onSplashScreenRemoved = onSplashScreenRemoved,
        )
        accessibilityDisclosureDestination(
            onDismiss = { navController.popBackStack() },
            onSplashScreenRemoved = onSplashScreenRemoved,
        )
        updateBiometricsDestination(
            onDismiss = { navController.popBackStack() },
            onSplashScreenRemoved = onSplashScreenRemoved,
        )
    }
}

@Composable
private fun OverlayNavEventsEffect(
    viewModel: OverlayNavViewModel,
    navController: NavController,
) {
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            OverlayNavEvent.NavigateToUpdateBiometrics -> {
                navController.navigateToUpdateBiometrics()
            }

            OverlayNavEvent.NavigateToCookieAcquisition -> {
                navController.navigateToCookieAcquisition()
            }

            OverlayNavEvent.NavigateToLocalNetworkAccess -> {
                navController.navigateToLocalNetworkAccess()
            }

            OverlayNavEvent.NavigateToAccessibilityDisclosure -> {
                navController.navigateToAccessibilityDisclosure()
            }
        }
    }
}
