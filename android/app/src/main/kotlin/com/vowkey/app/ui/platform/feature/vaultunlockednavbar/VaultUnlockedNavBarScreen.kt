package com.vowkey.app.ui.platform.feature.vaultunlockednavbar

import androidx.compose.runtime.Composable
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.navigation.NavHostController
import com.vowkey.app.ui.platform.components.util.rememberVowkeyNavController
import com.vowkey.app.ui.platform.feature.search.model.SearchType
import com.vowkey.app.ui.tools.feature.send.addedit.AddEditSendRoute
import com.vowkey.app.ui.tools.feature.send.viewsend.ViewSendRoute
import com.vowkey.app.ui.vault.feature.addedit.VaultAddEditArgs
import com.vowkey.app.ui.vault.feature.item.VaultItemArgs
import com.vowkey.app.ui.vowkey.VowkeyWorkspaceScreen

/**
 * Top level composable for the Vault Unlocked Screen, hosting the unified Vowkey workspace.
 */
@Suppress("LongParameterList", "UnusedParameter")
@Composable
fun VaultUnlockedNavBarScreen(
    viewModel: VaultUnlockedNavBarViewModel = hiltViewModel(),
    navController: NavHostController = rememberVowkeyNavController(
        name = "VaultUnlockedNavBarScreen",
    ),
    onNavigateToVaultAddItem: (args: VaultAddEditArgs) -> Unit,
    onNavigateToVaultItem: (args: VaultItemArgs) -> Unit,
    onNavigateToVaultEditItem: (args: VaultAddEditArgs) -> Unit,
    onNavigateToSearchSend: (searchType: SearchType.Sends) -> Unit,
    onNavigateToSearchVault: (searchType: SearchType.Vault) -> Unit,
    onNavigateToAddEditSend: (route: AddEditSendRoute) -> Unit,
    onNavigateToViewSend: (ViewSendRoute) -> Unit,
    onNavigateToDeleteAccount: () -> Unit,
    onNavigateToExportVault: () -> Unit,
    onNavigateToFolders: () -> Unit,
    onNavigateToPendingRequests: () -> Unit,
    onNavigateToPasswordHistory: () -> Unit,
    onNavigateToSetupUnlockScreen: () -> Unit,
    onNavigateToSetupAutoFillScreen: () -> Unit,
    onNavigateToSetupBrowserAutofill: () -> Unit,
    onNavigateToFlightRecorder: () -> Unit,
    onNavigateToRecordedLogs: () -> Unit,
    onNavigateToImportLogins: () -> Unit,
    onNavigateToAddFolderScreen: (selectedFolderId: String?) -> Unit,
    onNavigateToAboutPrivilegedApps: () -> Unit,
    onNavigateToManageDevices: () -> Unit,
    onNavigateToPlan: () -> Unit,
    onNavigateToUpgradedToPremium: () -> Unit,
) {
    VowkeyWorkspaceScreen(
        onNavigateToSignIn = {},
        onNavigateToCreateAccount = {},
        onNavigateToAutofillSettings = onNavigateToSetupAutoFillScreen,
    )
}
