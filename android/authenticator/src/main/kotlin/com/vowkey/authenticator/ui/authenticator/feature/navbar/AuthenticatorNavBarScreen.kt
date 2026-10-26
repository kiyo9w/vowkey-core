package com.vowkey.authenticator.ui.authenticator.feature.navbar

import android.os.Parcelable
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.vowkey.authenticator.ui.authenticator.feature.itemlisting.ItemListingGraphRoute
import com.vowkey.authenticator.ui.authenticator.feature.itemlisting.ItemListingRoute
import com.vowkey.authenticator.ui.authenticator.feature.itemlisting.itemListingGraph
import com.vowkey.authenticator.ui.platform.feature.settings.SettingsGraphRoute
import com.vowkey.authenticator.ui.platform.feature.settings.SettingsRoute
import com.vowkey.authenticator.ui.platform.feature.settings.export.navigateToExport
import com.vowkey.authenticator.ui.platform.feature.settings.importing.navigateToImporting
import com.vowkey.authenticator.ui.platform.feature.settings.settingsGraph
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.navigateToTabOrRoot
import com.vowkey.ui.platform.components.navigation.model.NavigationItem
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.scaffold.model.ScaffoldNavigationData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.RootTransitionProviders
import com.vowkey.ui.platform.util.toObjectNavigationRoute
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.persistentListOf
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.parcelize.Parcelize

/**
 * Top level composable for the authenticator screens.
 */
@Composable
fun AuthenticatorNavBarScreen(
    viewModel: AuthenticatorNavBarViewModel = hiltViewModel(),
    navController: NavHostController = rememberNavController(),
    onNavigateBack: () -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToQrCodeScanner: () -> Unit,
    onNavigateToManualKeyEntry: () -> Unit,
    onNavigateToEditItem: (itemId: String) -> Unit,
    onNavigateToTutorial: () -> Unit,
) {
    EventsEffect(viewModel = viewModel) { event ->
        navController.navigateToTabOrRoot(target = event.tab)
    }

    LaunchedEffect(Unit) {
        navController
            .currentBackStackEntryFlow
            .onEach {
                viewModel.trySendAction(AuthenticatorNavBarAction.BackStackUpdate)
            }
            .launchIn(this)
    }

    AuthenticatorNavBarScaffold(
        navController = navController,
        verificationTabClickedAction = {
            viewModel.trySendAction(AuthenticatorNavBarAction.VerificationCodesTabClick)
        },
        settingsTabClickedAction = {
            viewModel.trySendAction(AuthenticatorNavBarAction.SettingsTabClick)
        },
        navigateBack = onNavigateBack,
        navigateToSearch = onNavigateToSearch,
        navigateToQrCodeScanner = onNavigateToQrCodeScanner,
        navigateToManualKeyEntry = onNavigateToManualKeyEntry,
        navigateToEditItem = onNavigateToEditItem,
        onNavigateToTutorial = onNavigateToTutorial,
    )
}

@Composable
private fun AuthenticatorNavBarScaffold(
    navController: NavHostController,
    verificationTabClickedAction: () -> Unit,
    settingsTabClickedAction: () -> Unit,
    navigateBack: () -> Unit,
    navigateToSearch: () -> Unit,
    navigateToQrCodeScanner: () -> Unit,
    navigateToManualKeyEntry: () -> Unit,
    navigateToEditItem: (itemId: String) -> Unit,
    onNavigateToTutorial: () -> Unit,
) {
    var shouldDimNavBar by rememberSaveable { mutableStateOf(value = false) }

    // This scaffold will host screens that contain top bars while not hosting one itself.
    // We need to ignore the all insets here and let the content screens handle it themselves.
    val navBackStackEntry by navController.currentBackStackEntryAsState()
    VowkeyScaffold(
        contentWindowInsets = WindowInsets(),
        navigationData = ScaffoldNavigationData(
            navigationItems = AuthenticatorNavBarTab.navigationItems,
            selectedNavigationItem = AuthenticatorNavBarTab
                .navigationItems
                .find { navBackStackEntry.isCurrentRoute(route = it.graphRoute) },
            onNavigationClick = { navigationItem ->
                when (navigationItem) {
                    AuthenticatorNavBarTab.VerificationCodes -> verificationTabClickedAction()
                    AuthenticatorNavBarTab.Settings -> settingsTabClickedAction()
                }
            },
            shouldDimNavigation = shouldDimNavBar,
        ),
    ) {
        NavHost(
            navController = navController,
            startDestination = ItemListingGraphRoute,
            enterTransition = RootTransitionProviders.Enter.fadeIn,
            exitTransition = RootTransitionProviders.Exit.fadeOut,
            popEnterTransition = RootTransitionProviders.Enter.fadeIn,
            popExitTransition = RootTransitionProviders.Exit.fadeOut,
        ) {
            itemListingGraph(
                onNavigateBack = navigateBack,
                onNavigateToSearch = navigateToSearch,
                onNavigateToQrCodeScanner = navigateToQrCodeScanner,
                onNavigateToManualKeyEntry = navigateToManualKeyEntry,
                onNavigateToEditItem = navigateToEditItem,
            )
            settingsGraph(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToTutorial = onNavigateToTutorial,
                onNavigateToExport = { navController.navigateToExport() },
                onNavigateToImport = { navController.navigateToImporting() },
            )
        }
    }
}

/**
 * Represents the different tabs available in the navigation bar
 * for the authenticator screens.
 *
 * Each tab is modeled with properties that provide information on:
 * - Regular icon resource
 * - Icon resource when selected
 * and other essential UI and navigational data.
 *
 * @property iconRes The resource ID for the regular (unselected) icon representing the tab.
 * @property iconResSelected The resource ID for the icon representing the tab when it's selected.
 */
@Parcelize
sealed class AuthenticatorNavBarTab : NavigationItem, Parcelable {

    @Suppress("UndocumentedPublicClass")
    companion object {
        /**
         * The list of navigation tabs available in the authenticator.
         */
        val navigationItems: ImmutableList<AuthenticatorNavBarTab> = persistentListOf(
            VerificationCodes,
            Settings,
        )
    }

    /**
     * Show the Verification Codes screen.
     */
    @Parcelize
    data object VerificationCodes : AuthenticatorNavBarTab() {
        override val iconResSelected get() = VowkeyDrawable.ic_verification_codes_filled
        override val iconRes get() = VowkeyDrawable.ic_verification_codes
        override val labelRes get() = VowkeyString.verification_codes
        override val graphRoute get() = ItemListingGraphRoute
        override val startDestinationRoute get() = ItemListingRoute
        override val testTag get() = "VerificationCodesTab"
        override val notificationCount: Int get() = 0
    }

    /**
     * Show the Settings screen.
     */
    @Parcelize
    data object Settings : AuthenticatorNavBarTab() {
        override val iconResSelected get() = VowkeyDrawable.ic_settings_filled
        override val iconRes get() = VowkeyDrawable.ic_settings
        override val labelRes get() = VowkeyString.settings
        override val graphRoute get() = SettingsGraphRoute
        override val startDestinationRoute get() = SettingsRoute
        override val testTag get() = "SettingsTab"
        override val notificationCount: Int get() = 0
    }
}

/**
 * Determine if the current destination is the same as the given tab.
 */
private fun NavBackStackEntry?.isCurrentRoute(route: Any): Boolean =
    this
        ?.destination
        ?.parent
        ?.route == route.toObjectNavigationRoute()
