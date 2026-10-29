package com.vowkey.app.ui.vault.feature.vault

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.LifecycleEventEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.account.VowkeyAccountActionItem
import com.vowkey.ui.platform.components.account.VowkeyAccountSwitcher
import com.vowkey.ui.platform.components.animation.AnimateNullableContentVisibility
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeyOverflowActionItem
import com.vowkey.ui.platform.components.appbar.action.VowkeySearchActionItem
import com.vowkey.ui.platform.components.appbar.model.OverflowMenuItemData
import com.vowkey.ui.platform.components.appbar.model.TopAppBarDividerStyle
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.actionCardExitAnimation
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.fab.VowkeyFloatingActionButton
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.scaffold.model.VowkeyPullToRefreshState
import com.vowkey.ui.platform.components.scaffold.model.rememberVowkeyPullToRefreshState
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbar
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarHostState
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyPlurals
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.platform.components.dialog.VowkeyMasterPasswordDialog
import com.vowkey.app.ui.platform.composition.LocalAppReviewManager
import com.vowkey.app.ui.platform.feature.search.model.SearchType
import com.vowkey.app.ui.platform.manager.review.AppReviewManager
import com.vowkey.app.ui.vault.components.VaultItemSelectionDialog
import com.vowkey.app.ui.vault.components.model.CreateVaultItemType
import com.vowkey.app.ui.vault.feature.addedit.VaultAddEditArgs
import com.vowkey.app.ui.vault.feature.item.VaultItemArgs
import com.vowkey.app.ui.vault.feature.vault.handlers.VaultHandlers
import com.vowkey.app.ui.vault.model.VaultAddEditType
import com.vowkey.app.ui.vault.model.VaultItemListingType
import kotlinx.collections.immutable.persistentListOf
import kotlinx.collections.immutable.toImmutableList
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.time.Duration.Companion.milliseconds

private const val APP_REVIEW_DELAY = 3000L

/**
 * The vault screen for the application.
 */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@Composable
fun VaultScreen(
    viewModel: VaultViewModel = hiltViewModel(),
    onNavigateToVaultAddItemScreen: (args: VaultAddEditArgs) -> Unit,
    onNavigateToVaultItemScreen: (args: VaultItemArgs) -> Unit,
    onNavigateToVaultEditItemScreen: (args: VaultAddEditArgs) -> Unit,
    onNavigateToVerificationCodeScreen: () -> Unit,
    onNavigateToVaultItemListingScreen: (vaultItemType: VaultItemListingType) -> Unit,
    onNavigateToSearchVault: (searchType: SearchType.Vault) -> Unit,
    onDimBottomNavBarRequest: (shouldDim: Boolean) -> Unit,
    onNavigateToImportLogins: () -> Unit,
    onNavigateToAddFolderScreen: (selectedFolderId: String?) -> Unit,
    onNavigateToAboutScreen: () -> Unit,
    onNavigateToAutofillScreen: () -> Unit,
    onNavigateToPlan: () -> Unit,
    onNavigateToSecrets: (kind: String, itemId: String?) -> Unit = { _, _ -> },
    intentManager: IntentManager = LocalIntentManager.current,
    appReviewManager: AppReviewManager = LocalAppReviewManager.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val pullToRefreshState = rememberVowkeyPullToRefreshState(
        isEnabled = state.isPullToRefreshEnabled,
        isRefreshing = state.isRefreshing,
        onRefresh = { viewModel.trySendAction(VaultAction.RefreshPull) },
    )
    val snackbarHostState = rememberVowkeySnackbarHostState()
    LifecycleEventEffect { _, event ->
        when (event) {
            Lifecycle.Event.ON_RESUME -> {
                viewModel.trySendAction(VaultAction.LifecycleResumed)
            }

            else -> Unit
        }
    }
    val scope = rememberCoroutineScope()
    val launchPrompt = remember {
        {
            scope.launch {
                delay(APP_REVIEW_DELAY.milliseconds)
                appReviewManager.promptForReview()
            }
        }
    }
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is VaultEvent.NavigateToAddItemScreen -> {
                onNavigateToVaultAddItemScreen(
                    VaultAddEditArgs(
                        vaultAddEditType = VaultAddEditType.AddItem(),
                        vaultItemCipherType = event.type,
                    ),
                )
            }

            VaultEvent.NavigateToVaultSearchScreen -> onNavigateToSearchVault(SearchType.Vault.All)

            is VaultEvent.NavigateToVerificationCodeScreen -> {
                onNavigateToVerificationCodeScreen()
            }

            is VaultEvent.NavigateToVaultItem -> {
                onNavigateToVaultItemScreen(VaultItemArgs(event.itemId, event.type))
            }
            is VaultEvent.NavigateToSecrets -> onNavigateToSecrets(event.kind, event.itemId)

            is VaultEvent.NavigateToEditVaultItem -> {
                onNavigateToVaultEditItemScreen(
                    VaultAddEditArgs(
                        vaultAddEditType = VaultAddEditType.EditItem(vaultItemId = event.itemId),
                        vaultItemCipherType = event.type,
                    ),
                )
            }

            is VaultEvent.NavigateToItemListing -> {
                onNavigateToVaultItemListingScreen(event.itemListingType)
            }

            is VaultEvent.NavigateToUrl -> intentManager.launchUri(event.url.toUri())
            VaultEvent.NavigateToImportLogins -> onNavigateToImportLogins()
            is VaultEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
            VaultEvent.PromptForAppReview -> {
                launchPrompt.invoke()
            }

            VaultEvent.NavigateToAddFolder -> {
                onNavigateToAddFolderScreen(null)
            }

            VaultEvent.NavigateToAbout -> onNavigateToAboutScreen()

            is VaultEvent.ShowShareSheet -> {
                intentManager.shareText(event.content)
            }

            VaultEvent.NavigateToAutofillSettings -> onNavigateToAutofillScreen()

            VaultEvent.NavigateToUpgradePremium -> onNavigateToPlan()
        }
    }
    val vaultHandlers = remember(viewModel) { VaultHandlers.create(viewModel) }
    VaultScreenScaffold(
        state = state,
        pullToRefreshState = pullToRefreshState,
        vaultHandlers = vaultHandlers,
        onDimBottomNavBarRequest = onDimBottomNavBarRequest,
        snackbarHostState = snackbarHostState,
        onNavigateToSecrets = onNavigateToSecrets,
    )
}

/**
 * Scaffold for the [VaultScreen]
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun VaultScreenScaffold(
    state: VaultState,
    pullToRefreshState: VowkeyPullToRefreshState,
    vaultHandlers: VaultHandlers,
    onDimBottomNavBarRequest: (shouldDim: Boolean) -> Unit,
    snackbarHostState: VowkeySnackbarHostState,
    onNavigateToSecrets: (String, String?) -> Unit,
) {
    var accountMenuVisible by rememberSaveable {
        mutableStateOf(false)
    }
    val updateAccountMenuVisibility = { shouldShowMenu: Boolean ->
        accountMenuVisible = shouldShowMenu
        onDimBottomNavBarRequest(shouldShowMenu)
    }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(
        state = rememberTopAppBarState(),
        canScroll = { !accountMenuVisible },
    )

    // Dynamic dialogs
    VaultDialogs(dialogState = state.dialog, vaultHandlers = vaultHandlers)
    VowkeyScaffold(
        topBar = {
            VowkeyMediumTopAppBar(
                title = state.appBarTitle(),
                scrollBehavior = scrollBehavior,
                dividerStyle = state
                    .vaultFilterDataWithFilter
                    ?.let { TopAppBarDividerStyle.STATIC }
                    ?: TopAppBarDividerStyle.ON_SCROLL,
                actions = {
                    VowkeyAccountActionItem(
                        initials = state.initials,
                        color = state.avatarColor,
                        onClick = {
                            updateAccountMenuVisibility(!accountMenuVisible)
                        },
                    )
                    VowkeySearchActionItem(
                        contentDescription = stringResource(id = VowkeyString.search_vault),
                        isDisplayed = state.shouldShowSearchIcon,
                        onClick = vaultHandlers.searchIconClickAction,
                    )
                    VowkeyOverflowActionItem(
                        menuItemDataList = persistentListOf(
                            OverflowMenuItemData(
                                text = stringResource(id = com.vowkey.app.R.string.vk_keys),
                                onClick = { onNavigateToSecrets("key", null) },
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = com.vowkey.app.R.string.vk_environments),
                                onClick = { onNavigateToSecrets("environment", null) },
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.sync),
                                onClick = vaultHandlers.syncAction,
                            ),
                            OverflowMenuItemData(
                                text = stringResource(id = VowkeyString.lock),
                                onClick = vaultHandlers.lockAction,
                            ),
                        ),
                    )
                },
            )
        },
        utilityBar = {
            state.vaultFilterDataWithFilter?.let {
                VaultFilter(
                    selectedVaultFilterType = it.selectedVaultFilterType,
                    vaultFilterTypes = it.vaultFilterTypes.toImmutableList(),
                    onVaultFilterTypeSelect = vaultHandlers.vaultFilterTypeSelect,
                    topAppBarScrollBehavior = scrollBehavior,
                    modifier = Modifier
                        .padding(
                            start = 16.dp,
                            // There is some built-in padding to the menu button that makes up
                            // the visual difference here.
                            end = 12.dp,
                        )
                        .fillMaxWidth(),
                )
            }
        },
        snackbarHost = {
            AnimateNullableContentVisibility(
                targetState = state.flightRecorderSnackBar,
                label = "AnimateFlightRecorderSnackbar",
            ) { data ->
                VowkeySnackbar(
                    vowkeySnackbarData = data,
                    onDismiss = vaultHandlers.dismissFlightRecorderSnackbar,
                    onActionClick = vaultHandlers.flightRecorderGoToSettingsClick,
                )
            }
            if (state.flightRecorderSnackBar == null) {
                // We don't want additional animations from the Animated Visibility and we only
                // want this displayed if the flight recorder snackbar is not set.
                VowkeySnackbarHost(
                    vowkeyHostState = snackbarHostState,
                )
            }
        },
        floatingActionButton = {
            AnimatedVisibility(
                visible = state.viewState.hasFab && !accountMenuVisible,
                enter = scaleIn(),
                exit = scaleOut(),
            ) {
                VowkeyFloatingActionButton(
                    onClick = vaultHandlers.selectAddItemTypeClickAction,
                    painter = rememberVectorPainter(id = VowkeyDrawable.ic_plus_large),
                    contentDescription = stringResource(id = VowkeyString.add_item),
                    modifier = Modifier.testTag(tag = "AddItemButton"),
                )
            }
        },
        overlay = {
            VowkeyAccountSwitcher(
                isVisible = accountMenuVisible,
                accountSummaries = state.accountSummaries,
                onSwitchAccountClick = vaultHandlers.accountSwitchClickAction,
                onLockAccountClick = vaultHandlers.accountLockClickAction,
                onLogoutAccountClick = vaultHandlers.accountLogoutClickAction,
                onAddAccountClick = vaultHandlers.addAccountClickAction,
                onDismissRequest = { updateAccountMenuVisibility(false) },
                topAppBarScrollBehavior = scrollBehavior,
                modifier = Modifier.fillMaxSize(),
            )
        },
        pullToRefreshState = pullToRefreshState,
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
    ) {
        Column(
            modifier = Modifier.fillMaxSize(),
        ) {
            when (val viewState = state.viewState) {
                is VaultState.ViewState.Content -> VaultContent(
                    state = viewState,
                    actionCardState = state.actionCard,
                    vaultHandlers = vaultHandlers,
                    modifier = Modifier.fillMaxSize(),
                )

                is VaultState.ViewState.Loading -> VowkeyLoadingContent(
                    modifier = Modifier.fillMaxSize(),
                )

                is VaultState.ViewState.NoItems -> {
                    AnimateNullableContentVisibility(
                        targetState = state.actionCard,
                        exit = actionCardExitAnimation(),
                        label = "VaultNoItemsActionCard",
                    ) { actionCard ->
                        VaultActionCard(
                            actionCardState = actionCard,
                            vaultHandlers = vaultHandlers,
                            modifier = Modifier
                                .fillMaxWidth()
                                .standardHorizontalMargin()
                                .padding(top = 12.dp),
                        )
                    }
                    VaultNoItems(
                        vectorRes = VowkeyDrawable.ill_vault_items,
                        headerText = stringResource(
                            id = VowkeyString.save_and_protect_your_data,
                        ),
                        message = stringResource(
                            VowkeyString.the_vault_protects_more_than_just_passwords,
                        ),
                        buttonText = stringResource(id = VowkeyString.add_login),
                        policyDisablesSend = false,
                        addItemClickAction = {
                            vaultHandlers.addItemClickAction(CreateVaultItemType.LOGIN)
                        },
                        modifier = Modifier.fillMaxSize(),
                    )
                }

                is VaultState.ViewState.Error -> VowkeyErrorContent(
                    message = viewState.message(),
                    buttonData = VowkeyButtonData(
                        label = VowkeyString.try_again.asText(),
                        onClick = vaultHandlers.tryAgainClick,
                    ),
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Suppress("LongMethod")
@Composable
private fun VaultDialogs(
    dialogState: VaultState.DialogState?,
    vaultHandlers: VaultHandlers,
) {
    when (dialogState) {
        VaultState.DialogState.ArchiveRequiresPremium -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.premium_subscription_required),
                message = stringResource(id = VowkeyString.archiving_items_is_a_premium_feature),
                confirmButtonText = stringResource(id = VowkeyString.upgrade_to_premium),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = vaultHandlers.upgradeToPremiumClick,
                onDismissClick = vaultHandlers.dialogDismiss,
                onDismissRequest = vaultHandlers.dialogDismiss,
            )
        }

        is VaultState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        is VaultState.DialogState.Syncing -> VowkeyLoadingDialog(
            text = stringResource(id = VowkeyString.syncing),
        )

        is VaultState.DialogState.Error -> VowkeyBasicDialog(
            title = dialogState.title(),
            message = dialogState.message(),
            throwable = dialogState.error,
            onDismissRequest = vaultHandlers.dialogDismiss,
        )

        is VaultState.DialogState.SelectVaultAddItemType -> VaultItemSelectionDialog(
            onOptionSelected = {
                vaultHandlers.addItemClickAction(it)
            },
            onDismissRequest = vaultHandlers.dialogDismiss,
            excludedOptions = dialogState.excludedOptions,
        )

        is VaultState.DialogState.CipherDecryptionError -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                confirmButtonText = stringResource(VowkeyString.copy_error_report),
                dismissButtonText = stringResource(VowkeyString.close),
                onConfirmClick = {
                    vaultHandlers.onShareCipherDecryptionErrorClick(dialogState.selectedCipherId)
                },
                onDismissClick = vaultHandlers.dialogDismiss,
                onDismissRequest = vaultHandlers.dialogDismiss,
            )
        }

        is VaultState.DialogState.ThirdPartyBrowserAutofill -> {
            VowkeyTwoButtonDialog(
                title = stringResource(
                    id = VowkeyString.enable_browser_autofill_to_keep_filling_passwords,
                ),
                message = stringResource(
                    id = VowkeyString.your_browser_recently_updated_how_autofill_works_singular,
                ),
                confirmButtonText = stringResource(id = VowkeyString.go_to_settings),
                dismissButtonText = stringResource(id = VowkeyString.not_now),
                onConfirmClick = vaultHandlers.onEnabledThirdPartyAutofillClick,
                onDismissClick = vaultHandlers.onDismissThirdPartyAutofillDialogClick,
                onDismissRequest = vaultHandlers.onDismissThirdPartyAutofillDialogClick,
                dismissOnBackPress = false,
                dismissOnClickOutside = false,
            )
        }

        is VaultState.DialogState.VaultLoadCipherDecryptionError -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title(),
                message = pluralStringResource(
                    id = VowkeyPlurals
                        .vowkey_could_not_decrypt_x_vault_item_copy_and_share_description_long,
                    count = dialogState.cipherCount,
                    dialogState.cipherCount,
                ),
                confirmButtonText = stringResource(VowkeyString.copy_error_report),
                dismissButtonText = stringResource(VowkeyString.close),
                onConfirmClick = {
                    vaultHandlers.onShareAllCipherDecryptionErrorsClick()
                },
                onDismissClick = vaultHandlers.dialogDismiss,
                onDismissRequest = vaultHandlers.dialogDismiss,
            )
        }

        is VaultState.DialogState.VaultLoadKdfUpdateRequired -> {
            VowkeyMasterPasswordDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                dismissButtonText = stringResource(VowkeyString.later),
                onConfirmClick = {
                    vaultHandlers.onKdfUpdatePasswordRepromptSubmit(it)
                },
                onDismissRequest = vaultHandlers.dialogDismiss,
            )
        }

        is VaultState.DialogState.SyncError -> {
            VowkeyTwoButtonDialog(
                title = dialogState.title(),
                message = dialogState.message(),
                confirmButtonText = stringResource(id = VowkeyString.try_again),
                dismissButtonText = stringResource(id = VowkeyString.not_now),
                onConfirmClick = vaultHandlers.tryAgainClick,
                onDismissClick = vaultHandlers.dialogDismiss,
                onDismissRequest = vaultHandlers.dialogDismiss,
            )
        }

        null -> Unit
    }
}
