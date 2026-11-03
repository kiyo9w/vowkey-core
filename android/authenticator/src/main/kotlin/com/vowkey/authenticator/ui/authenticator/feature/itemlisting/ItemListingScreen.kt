package com.vowkey.authenticator.ui.authenticator.feature.itemlisting

import android.Manifest
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.authenticator.ui.platform.components.listitem.VaultVerificationCodeItem
import com.vowkey.authenticator.ui.platform.components.listitem.model.SharedCodesDisplayState
import com.vowkey.authenticator.ui.platform.components.listitem.model.VaultDropdownMenuAction
import com.vowkey.authenticator.ui.platform.components.listitem.model.VerificationCodeDisplayItem
import com.vowkey.authenticator.ui.platform.composition.LocalPermissionsManager
import com.vowkey.authenticator.ui.platform.manager.permissions.PermissionsManager
import com.vowkey.authenticator.ui.platform.util.startVowkeyAccountSettings
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.appbar.action.VowkeySearchActionItem
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.fab.VowkeyExpandableFloatingActionButton
import com.vowkey.ui.platform.components.fab.model.ExpandableFabIcon
import com.vowkey.ui.platform.components.fab.model.ExpandableFabOption
import com.vowkey.ui.platform.components.header.VowkeyExpandingHeader
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.util.startAppSettingsActivity
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import kotlinx.collections.immutable.persistentListOf

/**
 * Displays the item listing screen.
 */
@Suppress("LongMethod", "CyclomaticComplexMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemListingScreen(
    viewModel: ItemListingViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    permissionsManager: PermissionsManager = LocalPermissionsManager.current,
    onNavigateBack: () -> Unit,
    onNavigateToSearch: () -> Unit,
    onNavigateToQrCodeScanner: () -> Unit,
    onNavigateToManualKeyEntry: () -> Unit,
    onNavigateToEditItemScreen: (id: String) -> Unit,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    val launcher = permissionsManager.getLauncher { isGranted ->
        if (isGranted) {
            viewModel.trySendAction(ItemListingAction.ScanQrCodeClick)
        } else {
            viewModel.trySendAction(ItemListingAction.EnterSetupKeyClick)
        }
    }
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is ItemListingEvent.NavigateBack -> onNavigateBack()
            is ItemListingEvent.NavigateToSearch -> onNavigateToSearch()
            is ItemListingEvent.NavigateToQrCodeScanner -> onNavigateToQrCodeScanner()
            is ItemListingEvent.NavigateToManualAddItem -> onNavigateToManualKeyEntry()
            is ItemListingEvent.ShowSnackbar -> {
                snackbarHostState.showSnackbar(snackbarData = event.data)
            }

            is ItemListingEvent.NavigateToEditItem -> onNavigateToEditItemScreen(event.id)
            is ItemListingEvent.NavigateToAppSettings -> {
                intentManager.startAppSettingsActivity()
            }

            ItemListingEvent.NavigateToVowkeyListing -> {
                intentManager.launchUri(
                    "https://play.google.com/store/apps/details?id=com.vowkey.app".toUri(),
                )
            }

            ItemListingEvent.NavigateToSyncInformation -> {
                intentManager.launchUri("https://vowkey.app".toUri())
            }

            ItemListingEvent.NavigateToVowkeySettings -> {
                intentManager.startVowkeyAccountSettings()
            }
        }
    }

    ItemListingDialogs(
        dialog = state.dialog,
        onDismissRequest = { viewModel.trySendAction(ItemListingAction.DialogDismiss) },
        onConfirmDeleteClick = {
            viewModel.trySendAction(ItemListingAction.ConfirmDeleteClick(it))
        },
    )

    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyMediumTopAppBar(
                title = stringResource(id = VowkeyString.verification_codes),
                scrollBehavior = scrollBehavior,
                actions = {
                    VowkeySearchActionItem(
                        contentDescription = stringResource(id = VowkeyString.search_codes),
                        isDisplayed = state.shouldShowSearchIcon,
                        onClick = onNavigateToSearch,
                    )
                },
            )
        },
        floatingActionButton = {
            VowkeyExpandableFloatingActionButton(
                modifier = Modifier.testTag("AddItemButton"),
                items = persistentListOf(
                    ExpandableFabOption(
                        label = VowkeyString.scan_a_qr_code.asText(),
                        icon = IconData.Local(
                            iconRes = VowkeyDrawable.ic_camera_small,
                            contentDescription = null,
                            testTag = "ScanQRCodeButton",
                        ),
                        onFabOptionClick = { launcher.launch(Manifest.permission.CAMERA) },
                    ),
                    ExpandableFabOption(
                        label = VowkeyString.enter_key_manually.asText(),
                        icon = IconData.Local(
                            iconRes = VowkeyDrawable.ic_lock_encrypted_small,
                            contentDescription = null,
                            testTag = "EnterSetupKeyButton",
                        ),
                        onFabOptionClick = {
                            viewModel.trySendAction(ItemListingAction.EnterSetupKeyClick)
                        },
                    ),
                ),
                expandableFabIcon = ExpandableFabIcon(
                    icon = IconData.Local(
                        iconRes = VowkeyDrawable.ic_plus_large,
                        contentDescription = VowkeyString.add_item.asText(),
                        testTag = "AddItemButton",
                    ),
                    iconRotation = 45f,
                ),
            )
        },
        snackbarHost = { VowkeySnackbarHost(vowkeyHostState = snackbarHostState) },
    ) {
        when (val currentState = state.viewState) {
            is ItemListingState.ViewState.Content -> {
                ItemListingContent(
                    state = currentState,
                    onItemClick = { viewModel.trySendAction(ItemListingAction.ItemClick(it)) },
                    onDropdownMenuClick = { action, item ->
                        viewModel.trySendAction(
                            ItemListingAction.DropdownMenuClick(menuAction = action, item = item),
                        )
                    },
                    onDownloadVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.DownloadVowkeyClick)
                    },
                    onDismissDownloadVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.DownloadVowkeyDismiss)
                    },
                    onSyncWithVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.SyncWithVowkeyClick)
                    },
                    onDismissSyncWithVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.SyncWithVowkeyDismiss)
                    },
                    onSyncLearnMoreClick = {
                        viewModel.trySendAction(ItemListingAction.SyncLearnMoreClick)
                    },
                    onSectionExpandedClick = {
                        viewModel.trySendAction(ItemListingAction.SectionExpandedClick(it))
                    },
                )
            }

            ItemListingState.ViewState.Loading -> {
                VowkeyLoadingContent(modifier = Modifier.fillMaxSize())
            }

            is ItemListingState.ViewState.NoItems -> {
                EmptyItemListingContent(
                    actionCardState = currentState.actionCard,
                    onAddCodeClick = { launcher.launch(Manifest.permission.CAMERA) },
                    onDownloadVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.DownloadVowkeyClick)
                    },
                    onDismissDownloadVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.DownloadVowkeyDismiss)
                    },
                    onSyncWithVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.SyncWithVowkeyClick)
                    },
                    onSyncLearnMoreClick = {
                        viewModel.trySendAction(ItemListingAction.SyncLearnMoreClick)
                    },
                    onDismissSyncWithVowkeyClick = {
                        viewModel.trySendAction(ItemListingAction.SyncWithVowkeyDismiss)
                    },
                )
            }
        }
    }
}

@Composable
private fun ItemListingDialogs(
    dialog: ItemListingState.DialogState?,
    onDismissRequest: () -> Unit,
    onConfirmDeleteClick: (itemId: String) -> Unit,
) {
    when (dialog) {
        ItemListingState.DialogState.Loading -> {
            VowkeyLoadingDialog(
                text = stringResource(id = VowkeyString.syncing),
            )
        }

        is ItemListingState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = dialog.title(),
                message = dialog.message(),
                onDismissRequest = onDismissRequest,
            )
        }

        is ItemListingState.DialogState.DeleteConfirmationPrompt -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.delete),
                message = dialog.message(),
                confirmButtonText = stringResource(id = VowkeyString.okay),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = {
                    onConfirmDeleteClick(dialog.itemId)
                },
                onDismissClick = onDismissRequest,
                onDismissRequest = onDismissRequest,
            )
        }

        null -> Unit
    }
}

@Suppress("LongMethod")
@Composable
private fun ItemListingContent(
    state: ItemListingState.ViewState.Content,
    onItemClick: (String) -> Unit,
    onDropdownMenuClick: (VaultDropdownMenuAction, VerificationCodeDisplayItem) -> Unit,
    onDownloadVowkeyClick: () -> Unit,
    onDismissDownloadVowkeyClick: () -> Unit,
    onSyncWithVowkeyClick: () -> Unit,
    onDismissSyncWithVowkeyClick: () -> Unit,
    onSyncLearnMoreClick: () -> Unit,
    onSectionExpandedClick: (SharedCodesDisplayState.SharedCodesAccountSection) -> Unit,
    modifier: Modifier = Modifier,
) {
    var isLocalHeaderExpanded by rememberSaveable { mutableStateOf(value = true) }
    LazyColumn(modifier = modifier.fillMaxSize()) {
        state.actionCard?.let {
            item(key = "action_card") {
                Spacer(modifier = Modifier.height(height = 12.dp))
                ActionCard(
                    actionCardState = it,
                    onDownloadVowkeyClick = onDownloadVowkeyClick,
                    onDownloadVowkeyDismissClick = onDismissDownloadVowkeyClick,
                    onSyncWithVowkeyClick = onSyncWithVowkeyClick,
                    onSyncWithVowkeyDismissClick = onDismissSyncWithVowkeyClick,
                    onSyncLearnMoreClick = onSyncLearnMoreClick,
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        }

        if (state.favoriteItems.isNotEmpty()) {
            item(key = "favorites_header") {
                Spacer(modifier = Modifier.height(height = 12.dp))
                VowkeyListHeaderText(
                    label = stringResource(id = VowkeyString.favorites),
                    supportingLabel = state.favoriteItems.count().toString(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .padding(horizontal = 16.dp)
                        .testTag("FavoritesHeaderLabel")
                        .animateItem(),
                )
                Spacer(modifier = Modifier.height(height = 8.dp))
            }

            itemsIndexed(
                items = state.favoriteItems,
                key = { _, it -> "favorite_item_${it.id}" },
            ) { index, item ->
                VaultVerificationCodeItem(
                    displayItem = item,
                    onItemClick = { onItemClick(item.authCode) },
                    onDropdownMenuClick = { action -> onDropdownMenuClick(action, item) },
                    cardStyle = state.favoriteItems.toListItemCardStyle(index = index),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        if (state.shouldShowLocalHeader) {
            item(key = "local_items_header") {
                VowkeyExpandingHeader(
                    collapsedText = stringResource(
                        id = VowkeyString.local_codes,
                        state.itemList.size,
                    ),
                    isExpanded = isLocalHeaderExpanded,
                    onClick = { isLocalHeaderExpanded = !isLocalHeaderExpanded },
                    capitalizeText = true,
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .animateItem(),
                )
            }
        } else if (state.sharedItems.isEmpty()) {
            item(key = "local_items_spacer") {
                Spacer(modifier = Modifier.height(height = 16.dp))
            }
        }

        if (isLocalHeaderExpanded) {
            itemsIndexed(
                items = state.itemList,
                key = { _, it -> "local_item_${it.id}" },
            ) { index, item ->
                VaultVerificationCodeItem(
                    displayItem = item,
                    onItemClick = { onItemClick(item.authCode) },
                    onDropdownMenuClick = { action -> onDropdownMenuClick(action, item) },
                    cardStyle = state.itemList.toListItemCardStyle(index = index),
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .fillMaxWidth()
                        .animateItem(),
                )
            }
        }

        when (state.sharedItems) {
            is SharedCodesDisplayState.Codes -> {
                state.sharedItems.sections.forEachIndexed { _, section ->
                    item(key = "sharedSection_${section.id}") {
                        VowkeyExpandingHeader(
                            collapsedText = section.label(),
                            isExpanded = section.isExpanded,
                            onClick = { onSectionExpandedClick(section) },
                            capitalizeText = true,
                            modifier = Modifier
                                .fillMaxWidth()
                                .standardHorizontalMargin()
                                .animateItem(),
                        )
                    }
                    if (section.isExpanded) {
                        itemsIndexed(
                            items = section.codes,
                            key = { _, code -> "code_${code.id}" },
                        ) { index, item ->
                            VaultVerificationCodeItem(
                                displayItem = item,
                                onItemClick = { onItemClick(item.authCode) },
                                onDropdownMenuClick = { action ->
                                    onDropdownMenuClick(action, item)
                                },
                                cardStyle = section.codes.toListItemCardStyle(index = index),
                                modifier = Modifier
                                    .standardHorizontalMargin()
                                    .fillMaxWidth()
                                    .animateItem(),
                            )
                        }
                    }
                }
            }

            SharedCodesDisplayState.Error -> {
                item(key = "shared_codes_error") {
                    Spacer(modifier = Modifier.height(height = 8.dp))
                    Text(
                        text = stringResource(VowkeyString.shared_codes_error),
                        color = VowkeyTheme.colorScheme.text.secondary,
                        style = VowkeyTheme.typography.bodySmall,
                        modifier = Modifier
                            .standardHorizontalMargin()
                            .padding(horizontal = 16.dp)
                            .animateItem(),
                    )
                }
            }
        }

        // Add a spacer item to prevent the FAB from hiding verification codes at the
        // bottom of the list
        item {
            Spacer(modifier = Modifier.height(height = 88.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

/**
 * Displays the item listing screen with no existing items.
 */
@Suppress("LongMethod")
@Composable
fun EmptyItemListingContent(
    actionCardState: ItemListingState.ActionCardState?,
    onAddCodeClick: () -> Unit,
    onDownloadVowkeyClick: () -> Unit,
    onDismissDownloadVowkeyClick: () -> Unit,
    onSyncWithVowkeyClick: () -> Unit,
    onSyncLearnMoreClick: () -> Unit,
    onDismissSyncWithVowkeyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
        verticalArrangement = when (actionCardState) {
            null -> Arrangement.Center
            ItemListingState.ActionCardState.DownloadVowkeyApp -> Arrangement.Top
            ItemListingState.ActionCardState.SyncWithVowkey -> Arrangement.Top
        },
    ) {
        actionCardState?.let {
            Spacer(modifier = Modifier.height(height = 12.dp))
            ActionCard(
                actionCardState = it,
                onDownloadVowkeyClick = onDownloadVowkeyClick,
                onDownloadVowkeyDismissClick = onDismissDownloadVowkeyClick,
                onSyncWithVowkeyClick = onSyncWithVowkeyClick,
                onSyncWithVowkeyDismissClick = onDismissSyncWithVowkeyClick,
                onSyncLearnMoreClick = onSyncLearnMoreClick,
                modifier = Modifier.standardHorizontalMargin(),
            )
            Spacer(modifier = Modifier.height(height = 16.dp))
        }

        Column(
            modifier = modifier
                .fillMaxSize()
                .standardHorizontalMargin(),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {

            Image(
                painter = rememberVectorPainter(id = VowkeyDrawable.ill_authenticator),
                contentDescription = stringResource(id = VowkeyString.empty_item_list),
                modifier = Modifier
                    .size(size = 100.dp)
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                text = stringResource(id = VowkeyString.you_dont_have_items_to_display),
                style = VowkeyTheme.typography.titleMedium,
            )

            Spacer(modifier = Modifier.height(16.dp))
            Text(
                textAlign = TextAlign.Center,
                text = stringResource(id = VowkeyString.empty_item_list_instruction),
            )

            Spacer(modifier = Modifier.height(16.dp))
            VowkeyFilledButton(
                modifier = Modifier
                    .testTag("AddCodeButton")
                    .fillMaxWidth(),
                label = stringResource(VowkeyString.add_code),
                onClick = onAddCodeClick,
            )

            Spacer(modifier = Modifier.height(height = 12.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

@Composable
private fun ActionCard(
    actionCardState: ItemListingState.ActionCardState,
    onDownloadVowkeyClick: () -> Unit,
    onDownloadVowkeyDismissClick: () -> Unit,
    onSyncWithVowkeyClick: () -> Unit,
    onSyncWithVowkeyDismissClick: () -> Unit,
    onSyncLearnMoreClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (actionCardState) {
        ItemListingState.ActionCardState.DownloadVowkeyApp -> {
            VowkeyActionCard(
                modifier = modifier,
                cardSubtitle = stringResource(id = VowkeyString.download_vowkey_card_message),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.download_now.asText(),
                    onClick = onDownloadVowkeyClick,
                ),
                cardTitle = stringResource(id = VowkeyString.download_vowkey_card_title),
                onDismissClick = onDownloadVowkeyDismissClick,
                leadingContent = {
                    Icon(
                        painter = rememberVectorPainter(id = VowkeyDrawable.ic_shield),
                        contentDescription = null,
                        tint = VowkeyTheme.colorScheme.icon.secondary,
                    )
                },
            )
        }

        ItemListingState.ActionCardState.SyncWithVowkey -> {
            VowkeyActionCard(
                modifier = modifier,
                cardTitle = stringResource(id = VowkeyString.sync_with_the_vowkey_app),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.take_me_to_app_settings.asText(),
                    onClick = onSyncWithVowkeyClick,
                ),
                cardSubtitle = stringResource(
                    id = VowkeyString.sync_with_vowkey_action_card_message,
                ),
                onDismissClick = onSyncWithVowkeyDismissClick,
                secondaryButton = VowkeyButtonData(
                    label = VowkeyString.learn_more.asText(),
                    onClick = onSyncLearnMoreClick,
                ),
                leadingContent = {
                    Icon(
                        painter = rememberVectorPainter(id = VowkeyDrawable.ic_refresh),
                        contentDescription = null,
                        tint = VowkeyTheme.colorScheme.icon.secondary,
                    )
                },
            )
        }
    }
}

@Composable
@Preview(showBackground = true)
private fun EmptyListingContentPreview() {
    EmptyItemListingContent(
        modifier = Modifier.padding(horizontal = 16.dp),
        onAddCodeClick = { },
        actionCardState = ItemListingState.ActionCardState.DownloadVowkeyApp,
        onDownloadVowkeyClick = { },
        onDismissDownloadVowkeyClick = { },
        onSyncWithVowkeyClick = { },
        onSyncLearnMoreClick = { },
        onDismissSyncWithVowkeyClick = { },
    )
}

@Composable
@Preview(showBackground = true)
private fun ContentPreview() {
    val email = "longemailaddress+verification+codes@email.com"
    VowkeyTheme {
        ItemListingContent(
            state = ItemListingState.ViewState.Content(
                actionCard = null,
                favoriteItems = persistentListOf(),
                itemList = persistentListOf(
                    VerificationCodeDisplayItem(
                        id = "",
                        title = "Local item",
                        subtitle = "with a subtitle",
                        timeLeftSeconds = 20,
                        periodSeconds = 30,
                        alertThresholdSeconds = 15,
                        authCode = "123456",
                        favorite = false,
                        showMoveToVowkey = true,
                        showOverflow = true,
                    ),
                ),
                sharedItems = SharedCodesDisplayState.Codes(
                    sections = persistentListOf(
                        SharedCodesDisplayState.SharedCodesAccountSection(
                            id = "id",
                            label = "$email | Bitawrden.eu (1)".asText(),
                            codes = persistentListOf(
                                VerificationCodeDisplayItem(
                                    id = "",
                                    title = "Shared item",
                                    subtitle = "with a subtitle",
                                    timeLeftSeconds = 15,
                                    periodSeconds = 30,
                                    alertThresholdSeconds = 15,
                                    authCode = "123456",
                                    favorite = false,
                                    showMoveToVowkey = false,
                                    showOverflow = false,
                                ),
                            ),
                            isExpanded = true,
                            sortKey = email,
                        ),
                    ),
                ),
            ),
            onItemClick = { },
            onDropdownMenuClick = { _, _ -> },
            onDownloadVowkeyClick = { },
            onDismissDownloadVowkeyClick = { },
            onSyncWithVowkeyClick = { },
            onDismissSyncWithVowkeyClick = { },
            onSyncLearnMoreClick = { },
            onSectionExpandedClick = { },
        )
    }
}
