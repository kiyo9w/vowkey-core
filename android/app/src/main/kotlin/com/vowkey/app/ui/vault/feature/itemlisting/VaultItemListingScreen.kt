package com.vowkey.app.ui.vault.feature.itemlisting

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.components.account.VowkeyAccountActionItem
import com.vowkey.ui.platform.components.account.VowkeyAccountSwitcher
import com.vowkey.ui.platform.components.account.util.initials
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.action.VowkeySearchActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.fab.VowkeyFloatingActionButton
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.scaffold.model.VowkeyPullToRefreshState
import com.vowkey.ui.platform.components.scaffold.model.rememberVowkeyPullToRefreshState
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarHostState
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalExitManager
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.exit.ExitManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.credentials.manager.CredentialProviderCompletionManager
import com.vowkey.app.ui.platform.components.dialog.VowkeyMasterPasswordDialog
import com.vowkey.app.ui.platform.components.dialog.VowkeyOverwriteCredentialConfirmationDialog
import com.vowkey.app.ui.platform.components.dialog.VowkeyPinDialog
import com.vowkey.app.ui.platform.composition.LocalBiometricsManager
import com.vowkey.app.ui.platform.composition.LocalCredentialProviderCompletionManager
import com.vowkey.app.ui.platform.feature.search.model.SearchType
import com.vowkey.app.ui.platform.feature.settings.accountsecurity.PinInputDialog
import com.vowkey.app.ui.platform.manager.biometrics.BiometricsManager
import com.vowkey.app.ui.tools.feature.send.addedit.AddEditSendRoute
import com.vowkey.app.ui.tools.feature.send.addedit.ModeType
import com.vowkey.app.ui.tools.feature.send.viewsend.ViewSendRoute
import com.vowkey.app.ui.vault.components.VaultItemSelectionDialog
import com.vowkey.app.ui.vault.feature.addedit.VaultAddEditArgs
import com.vowkey.app.ui.vault.feature.item.VaultItemArgs
import com.vowkey.app.ui.vault.feature.itemlisting.handlers.VaultItemListingHandlers
import com.vowkey.app.ui.vault.feature.itemlisting.handlers.VaultItemListingUserVerificationHandlers
import com.vowkey.app.ui.vault.model.VaultAddEditType
import com.vowkey.app.ui.vault.model.VaultItemListingType
import kotlinx.collections.immutable.persistentListOf

/**
 * Displays the vault item listing screen.
 */
@Composable
@Suppress("LongMethod", "CyclomaticComplexMethod")
fun VaultItemListingScreen(
    onNavigateBack: () -> Unit,
    onNavigateToVaultItemScreen: (args: VaultItemArgs) -> Unit,
    onNavigateToVaultEditItemScreen: (args: VaultAddEditArgs) -> Unit,
    onNavigateToVaultItemListing: (vaultItemListingType: VaultItemListingType) -> Unit,
    onNavigateToVaultAddItemScreen: (args: VaultAddEditArgs) -> Unit,
    onNavigateToAddFolder: (selectedFolderId: String?) -> Unit,
    onNavigateToAddEditSendItem: (route: AddEditSendRoute) -> Unit,
    onNavigateToViewSendItem: (route: ViewSendRoute) -> Unit,
    onNavigateToSearch: (searchType: SearchType) -> Unit,
    onNavigateToPlan: () -> Unit,
    onNavigateToSecrets: (String, String?) -> Unit = { _, _ -> },
    intentManager: IntentManager = LocalIntentManager.current,
    exitManager: ExitManager = LocalExitManager.current,
    credentialProviderCompletionManager: CredentialProviderCompletionManager =
        LocalCredentialProviderCompletionManager.current,
    biometricsManager: BiometricsManager = LocalBiometricsManager.current,
    viewModel: VaultItemListingViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val userVerificationHandlers = remember(viewModel) {
        VaultItemListingUserVerificationHandlers.create(viewModel = viewModel)
    }

    val pullToRefreshState = rememberVowkeyPullToRefreshState(
        isEnabled = state.isPullToRefreshEnabled,
        isRefreshing = state.isRefreshing,
        onRefresh = { viewModel.trySendAction(VaultItemListingsAction.RefreshPull) },
    )
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is VaultItemListingEvent.NavigateToSecrets -> onNavigateToSecrets(event.kind, event.id)
            is VaultItemListingEvent.NavigateBack -> onNavigateBack()

            is VaultItemListingEvent.NavigateToVaultItem -> {
                onNavigateToVaultItemScreen(VaultItemArgs(event.id, event.type))
            }

            is VaultItemListingEvent.ShowShareSheet -> {
                intentManager.shareText(event.content)
            }

            is VaultItemListingEvent.NavigateToAddVaultItem -> {
                onNavigateToVaultAddItemScreen(
                    VaultAddEditArgs(
                        vaultAddEditType = VaultAddEditType.AddItem(),
                        vaultItemCipherType = event.vaultItemCipherType,
                        selectedFolderId = event.selectedFolderId,
                        selectedCollectionId = event.selectedCollectionId,
                    ),
                )
            }

            is VaultItemListingEvent.NavigateToViewSendItem -> {
                onNavigateToViewSendItem(
                    ViewSendRoute(sendId = event.id, sendType = event.sendType),
                )
            }

            is VaultItemListingEvent.NavigateToEditCipher -> {
                onNavigateToVaultEditItemScreen(
                    VaultAddEditArgs(
                        vaultAddEditType = VaultAddEditType.EditItem(vaultItemId = event.cipherId),
                        vaultItemCipherType = event.cipherType,
                    ),
                )
            }

            is VaultItemListingEvent.NavigateToUrl -> {
                intentManager.launchUri(event.url.toUri())
            }

            VaultItemListingEvent.NavigateToPlanModal -> onNavigateToPlan()

            is VaultItemListingEvent.NavigateToAddSendItem -> {
                onNavigateToAddEditSendItem(
                    AddEditSendRoute(
                        sendType = event.sendType,
                        modeType = ModeType.ADD,
                    ),
                )
            }

            is VaultItemListingEvent.NavigateToEditSendItem -> {
                onNavigateToAddEditSendItem(
                    AddEditSendRoute(
                        sendType = event.sendType,
                        modeType = ModeType.EDIT,
                        sendId = event.id,
                    ),
                )
            }

            is VaultItemListingEvent.NavigateToSearchScreen -> {
                onNavigateToSearch(event.searchType)
            }

            is VaultItemListingEvent.NavigateToFolderItem -> {
                onNavigateToVaultItemListing(VaultItemListingType.Folder(event.folderId))
            }

            is VaultItemListingEvent.NavigateToCollectionItem -> {
                onNavigateToVaultItemListing(VaultItemListingType.Collection(event.collectionId))
            }

            is VaultItemListingEvent.CompleteCredentialRegistration -> {
                credentialProviderCompletionManager.completeCredentialRegistration(event.result)
            }

            is VaultItemListingEvent.CredentialManagerUserVerification -> {
                biometricsManager.promptUserVerification(
                    onSuccess = {
                        userVerificationHandlers
                            .onUserVerificationSuccess(event.selectedCipherView)
                    },
                    onCancel = userVerificationHandlers.onUserVerificationCancelled,
                    onLockOut = userVerificationHandlers.onUserVerificationLockOut,
                    onError = userVerificationHandlers.onUserVerificationFail,
                    onNotSupported = {
                        userVerificationHandlers.onUserVerificationNotSupported(
                            event.selectedCipherView.id,
                        )
                    },
                )
            }

            is VaultItemListingEvent.CompleteFido2Assertion -> {
                credentialProviderCompletionManager.completeFido2Assertion(event.result)
            }

            is VaultItemListingEvent.CompleteProviderGetCredentialsRequest -> {
                credentialProviderCompletionManager
                    .completeProviderGetCredentialsRequest(event.result)
            }

            is VaultItemListingEvent.CompleteProviderGetPasswordCredentialRequest -> {
                credentialProviderCompletionManager.completePasswordGet(event.result)
            }

            VaultItemListingEvent.ExitApp -> exitManager.exitApplication()

            is VaultItemListingEvent.NavigateToAddFolder -> {
                onNavigateToAddFolder(event.parentFolderName)
            }

            is VaultItemListingEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    val vaultItemListingHandlers = remember(viewModel) {
        VaultItemListingHandlers.create(viewModel)
    }
    VaultItemListingDialogs(
        dialogState = state.dialogState,
        vaultItemListingHandlers = vaultItemListingHandlers,
    )

    BackHandler(onBack = vaultItemListingHandlers.backClick)
    VaultItemListingScaffold(
        state = state,
        snackbarHostState = snackbarHostState,
        pullToRefreshState = pullToRefreshState,
        vaultItemListingHandlers = vaultItemListingHandlers,
    )
}

@Suppress("LongMethod")
@Composable
private fun VaultItemListingDialogs(
    dialogState: VaultItemListingState.DialogState?,
    vaultItemListingHandlers: VaultItemListingHandlers,
) {
    when (dialogState) {
        is VaultItemListingState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title?.invoke(),
            message = dialogState.message(),
            onDismissRequest = vaultItemListingHandlers.dismissDialogRequest,
            throwable = dialogState.throwable,
        )

        is VaultItemListingState.DialogState.Loading -> VowkeyLoadingDialog(
            text = dialogState.message(),
        )

        is VaultItemListingState.DialogState.CipherDecryptionError -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                confirmButtonText = stringResource(VowkeyString.copy_error_report),
                dismissButtonText = stringResource(VowkeyString.close),
                onConfirmClick = {
                    vaultItemListingHandlers.shareCipherDecryptionErrorClick(
                        dialogState.selectedCipherId,
                    )
                },
                onDismissClick = vaultItemListingHandlers.dismissDialogRequest,
                onDismissRequest = vaultItemListingHandlers.dismissDialogRequest,
            )
        }

        is VaultItemListingState.DialogState.CredentialManagerOperationFail -> VowkeyBasicDialog(
            title = dialogState.title(),
            message = dialogState.message(),
            onDismissRequest = {
                vaultItemListingHandlers.dismissCredentialManagerErrorDialog(dialogState.message)
            },
        )

        is VaultItemListingState.DialogState.OverwritePasskeyConfirmationPrompt -> {
            @Suppress("MaxLineLength")
            VowkeyOverwriteCredentialConfirmationDialog(
                title = stringResource(id = VowkeyString.overwrite_passkey),
                message = stringResource(
                    id = VowkeyString
                        .this_item_already_contains_a_passkey_are_you_sure_you_want_to_overwrite_the_current_passkey,
                ),
                onConfirmClick = {
                    vaultItemListingHandlers.confirmOverwriteExistingPasskey(
                        dialogState.cipherViewId,
                    )
                },
                onDismissRequest = vaultItemListingHandlers.dismissDialogRequest,
            )
        }

        is VaultItemListingState.DialogState.UserVerificationMasterPasswordPrompt -> {
            VowkeyMasterPasswordDialog(
                onConfirmClick = { password ->
                    vaultItemListingHandlers.submitMasterPasswordCredentialVerification(
                        password,
                        dialogState.selectedCipherId,
                    )
                },
                onDismissRequest = vaultItemListingHandlers.dismissUserVerification,
            )
        }

        is VaultItemListingState.DialogState.UserVerificationMasterPasswordError -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = {
                    vaultItemListingHandlers.retryGetCredentialPasswordVerification(
                        dialogState.selectedCipherId,
                    )
                },
            )
        }

        is VaultItemListingState.DialogState.UserVerificationPinPrompt -> {
            VowkeyPinDialog(
                onConfirmClick = { pin ->
                    vaultItemListingHandlers.submitPinCredentialVerification(
                        pin,
                        dialogState.selectedCipherId,
                    )
                },
                onDismissRequest = vaultItemListingHandlers.dismissUserVerification,
            )
        }

        is VaultItemListingState.DialogState.UserVerificationPinError -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = {
                    vaultItemListingHandlers.retryPinCredentialVerification(
                        dialogState.selectedCipherId,
                    )
                },
            )
        }

        is VaultItemListingState.DialogState.UserVerificationPinSetUpPrompt -> {
            PinInputDialog(
                onCancelClick = vaultItemListingHandlers.dismissUserVerification,
                onSubmitClick = { pin ->
                    vaultItemListingHandlers.submitPinSetUpCredentialVerification(
                        pin,
                        dialogState.selectedCipherId,
                    )
                },
                onDismissRequest = vaultItemListingHandlers.dismissUserVerification,
            )
        }

        is VaultItemListingState.DialogState.UserVerificationPinSetUpError -> {
            VowkeyBasicDialog(
                title = dialogState.title?.invoke(),
                message = dialogState.message(),
                onDismissRequest = {
                    vaultItemListingHandlers.retryPinSetUpCredentialVerification(
                        dialogState.selectedCipherId,
                    )
                },
            )
        }

        is VaultItemListingState.DialogState.VaultItemTypeSelection -> {
            VaultItemSelectionDialog(
                onDismissRequest = vaultItemListingHandlers.dismissDialogRequest,
                onOptionSelected = vaultItemListingHandlers.vaultItemTypeSelected,
                excludedOptions = dialogState.excludedOptions,
            )
        }

        is VaultItemListingState.DialogState.TrustPrivilegedAddPrompt -> {
            VowkeyTwoButtonDialog(
                title = stringResource(VowkeyString.unrecognized_browser),
                message = dialogState.message.invoke(),
                confirmButtonText = stringResource(VowkeyString.trust),
                dismissButtonText = stringResource(VowkeyString.cancel),
                onConfirmClick = {
                    vaultItemListingHandlers.trustPrivilegedAppClick(dialogState.selectedCipherId)
                },
                onDismissClick = {
                    vaultItemListingHandlers.dismissCredentialManagerErrorDialog(
                        VowkeyString
                            .passkey_operation_failed_because_the_browser_is_not_trusted
                            .asText(),
                    )
                },
                onDismissRequest = {
                    vaultItemListingHandlers.dismissCredentialManagerErrorDialog(
                        VowkeyString
                            .passkey_operation_failed_because_the_browser_is_not_trusted
                            .asText(),
                    )
                },
            )
        }

        is VaultItemListingState.DialogState.ArchiveRequiresPremium -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.premium_subscription_required),
                message = stringResource(id = VowkeyString.archiving_items_is_a_premium_feature),
                confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = vaultItemListingHandlers.upgradeToPremiumClick,
                onDismissClick = vaultItemListingHandlers.dismissDialogRequest,
                onDismissRequest = vaultItemListingHandlers.dismissDialogRequest,
            )
        }

        is VaultItemListingState.DialogState.FileTypeRequiresPremium -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.premium_subscription_required),
                message = stringResource(id = VowkeyString.send_file_premium_required),
                confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = vaultItemListingHandlers.upgradeToPremiumClick,
                onDismissClick = vaultItemListingHandlers.dismissDialogRequest,
                onDismissRequest = vaultItemListingHandlers.dismissDialogRequest,
            )
        }

        null -> Unit
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Suppress("LongMethod")
@Composable
private fun VaultItemListingScaffold(
    state: VaultItemListingState,
    pullToRefreshState: VowkeyPullToRefreshState,
    snackbarHostState: VowkeySnackbarHostState,
    vaultItemListingHandlers: VaultItemListingHandlers,
) {
    var isAccountMenuVisible by rememberSaveable { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = state.appBarTitle(),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                    navigationIconContentDescription = stringResource(id = VowkeyString.back),
                    onNavigationIconClick = vaultItemListingHandlers.backClick,
                )
                    .takeIf { state.shouldShowNavigationIcon },
                actions = {
                    if (state.shouldShowAccountSwitcher) {
                        VowkeyAccountActionItem(
                            initials = state.activeAccountSummary.initials,
                            color = state.activeAccountSummary.avatarColor,
                            onClick = { isAccountMenuVisible = !isAccountMenuVisible },
                        )
                    }
                    VowkeySearchActionItem(
                        contentDescription = stringResource(id = VowkeyString.search_vault),
                        isDisplayed = state.shouldShowSearchIcon,
                        onClick = vaultItemListingHandlers.searchIconClick,
                    )
                    VowkeyOverflowActionItem(
                        isVisible = state.shouldShowOverflowMenu,
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.sync),
                                onClick = vaultItemListingHandlers.syncClick,
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.lock),
                                onClick = vaultItemListingHandlers.lockClick,
                            ),
                        ),
                    )
                },
            )
        },
        floatingActionButton = {
            if (state.hasAddItemFabButton) {
                VowkeyFloatingActionButton(
                    onClick = vaultItemListingHandlers.addVaultItemClick,
                    painter = rememberVectorPainter(id = VowkeyDrawable.ic_plus_large),
                    contentDescription = stringResource(id = VowkeyString.add_item),
                    modifier = Modifier.testTag(tag = "AddItemButton"),
                )
            }
        },
        overlay = {
            VowkeyAccountSwitcher(
                isVisible = isAccountMenuVisible,
                accountSummaries = state.accountSummaries,
                onSwitchAccountClick = vaultItemListingHandlers.switchAccountClick,
                onLockAccountClick = vaultItemListingHandlers.lockAccountClick,
                onLogoutAccountClick = vaultItemListingHandlers.logoutAccountClick,
                onAddAccountClick = {
                    // Not available
                },
                onDismissRequest = { isAccountMenuVisible = false },
                isAddAccountAvailable = false,
                topAppBarScrollBehavior = scrollBehavior,
                modifier = Modifier.fillMaxSize(),
            )
        },
        pullToRefreshState = pullToRefreshState,
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        when (state.viewState) {
            is VaultItemListingState.ViewState.Content -> {
                VaultItemListingContent(
                    state = state.viewState,
                    actionCard = state.actionCard,
                    showAddTotpBanner = state.isTotp,
                    policyDisablesSend = state.policyDisablesSend &&
                        state.itemListingType is VaultItemListingState.ItemListingType.Send,
                    vaultItemListingHandlers = vaultItemListingHandlers,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is VaultItemListingState.ViewState.NoItems -> {
                VaultItemListingEmpty(
                    state = state.viewState,
                    policyDisablesSend = state.policyDisablesSend &&
                        state.itemListingType is VaultItemListingState.ItemListingType.Send,
                    addItemClickAction = vaultItemListingHandlers.addVaultItemClick,
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is VaultItemListingState.ViewState.Error -> {
                VowkeyErrorContent(
                    message = state.viewState.message(),
                    buttonData = VowkeyButtonData(
                        label = VowkeyString.try_again.asText(),
                        onClick = vaultItemListingHandlers.refreshClick,
                    ),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is VaultItemListingState.ViewState.Loading -> {
                VowkeyLoadingContent(modifier = Modifier.fillMaxSize())
            }
        }
    }
}
