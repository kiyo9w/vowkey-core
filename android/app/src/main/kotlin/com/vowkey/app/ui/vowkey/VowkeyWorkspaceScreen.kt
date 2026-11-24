@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod")

package com.vowkey.app.ui.vowkey

import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.core.view.WindowCompat
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.vowkey.app.BuildConfig
import com.vowkey.app.ui.auth.feature.landing.VowkeyBrandHeader
import com.vowkey.app.ui.platform.feature.settings.agents.AgentsTabContent
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.row.VowkeyPushRow
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.scaffold.model.ScaffoldNavigationData
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.feature.settings.appearance.model.AppTheme
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import kotlinx.collections.immutable.persistentListOf
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable

@Serializable
data object VowkeyWorkspaceRoute

fun NavGraphBuilder.vowkeyWorkspaceDestination(
    onNavigateToSignIn: () -> Unit,
    onNavigateToCreateAccount: () -> Unit,
    onNavigateToAutofillSettings: (() -> Unit)? = null,
) {
    composable<VowkeyWorkspaceRoute> {
        VowkeyWorkspaceScreen(
            onNavigateToSignIn = onNavigateToSignIn,
            onNavigateToCreateAccount = onNavigateToCreateAccount,
            onNavigateToAutofillSettings = onNavigateToAutofillSettings,
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyWorkspaceScreen(
    onNavigateToSignIn: () -> Unit,
    onNavigateToCreateAccount: () -> Unit,
    onNavigateToAutofillSettings: (() -> Unit)? = null,
    viewModel: VowkeyWorkspaceViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val palette = currentVowkeyPalette()
    val view = LocalView.current
    val activity = LocalActivity.current
    SideEffect {
        val window = activity?.window ?: return@SideEffect
        WindowCompat.getInsetsController(window, view).apply {
            isAppearanceLightStatusBars = !palette.isDark
            isAppearanceLightNavigationBars = !palette.isDark
        }
    }
    val selectedDocument = remember(state.selectedDocumentId, state.documents) {
        state.documents.firstOrNull { it.id == state.selectedDocumentId }
    }
    val selectedCipher = remember(state.selectedCipherId, state.items) {
        state.items.firstOrNull { it.id == state.selectedCipherId }
    }

    val canInterceptBack = selectedDocument != null ||
        selectedCipher != null ||
        state.selectedTab != VowkeyTab.VAULT

    BackHandler(enabled = canInterceptBack) {
        when {
            selectedDocument != null -> viewModel.openDocumentDetail(null)
            selectedCipher != null -> viewModel.openCipherDetail(null)
            state.selectedTab != VowkeyTab.VAULT -> viewModel.selectTab(VowkeyTab.VAULT)
        }
    }

    // Full-screen detail pushes inside workspace
    if (selectedDocument != null) {
        val owner = state.items.firstOrNull { it.id == selectedDocument.cipherId }
        VowkeyDocumentDetailScreen(
            document = selectedDocument,
            ownerCipher = owner,
            viewModel = viewModel,
            onBack = { viewModel.openDocumentDetail(null) },
            onOpenProfile = { profId ->
                viewModel.openDocumentDetail(null)
                viewModel.openCipherDetail(profId)
            },
        )
    } else if (selectedCipher != null) {
        if (selectedCipher.type == CipherType.IDENTITY) {
            VowkeyProfileDetailScreen(
                cipher = selectedCipher,
                viewModel = viewModel,
                onBack = { viewModel.openCipherDetail(null) },
                onOpenDocument = { doc -> viewModel.openDocumentDetail(doc.id) },
            )
        } else {
            VowkeyItemDetailScreen(
                cipher = selectedCipher,
                viewModel = viewModel,
                onBack = { viewModel.openCipherDetail(null) },
            )
        }
    } else {
        val navItems = remember {
            persistentListOf(
                VowkeyTab.VAULT,
                VowkeyTab.DOCUMENTS,
                VowkeyTab.AGENTS,
                VowkeyTab.SETTINGS,
            )
        }
        var addMenuExpanded by remember { mutableStateOf(false) }
        val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()

        val title = when (state.selectedTab) {
            VowkeyTab.VAULT -> "Vault"
            VowkeyTab.DOCUMENTS -> "Documents"
            VowkeyTab.AGENTS -> "AI agents"
            VowkeyTab.SETTINGS -> "Settings"
        }

        VowkeyScaffold(
            modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
            topBar = {
                VowkeyMediumTopAppBar(
                    title = title,
                    scrollBehavior = scrollBehavior,
                    actions = {
                        when (state.selectedTab) {
                            VowkeyTab.VAULT -> {
                                if (!state.isSignedIn) {
                                    VowkeyTextButton(
                                        label = "Sign in",
                                        onClick = onNavigateToSignIn,
                                    )
                                }
                                if (state.profiles.isNotEmpty()) {
                                    VowkeyTextButton(
                                        label = "Fill form",
                                        onClick = { viewModel.openFillForm(null) },
                                    )
                                }
                                Box {
                                    VowkeyStandardIconButton(
                                        vectorIconRes = VowkeyDrawable.ic_plus,
                                        contentDescription = "Add",
                                        onClick = { addMenuExpanded = true },
                                    )
                                    DropdownMenu(
                                        expanded = addMenuExpanded,
                                        onDismissRequest = { addMenuExpanded = false },
                                    ) {
                                        DropdownMenuItem(
                                            text = { Text("Add document") },
                                            onClick = {
                                                addMenuExpanded = false
                                                viewModel.openAddDocument(null)
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("New profile") },
                                            onClick = {
                                                addMenuExpanded = false
                                                viewModel.startCreateCipher(VowkeyItemKind.PROFILE)
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("New login") },
                                            onClick = {
                                                addMenuExpanded = false
                                                viewModel.startCreateCipher(VowkeyItemKind.LOGIN)
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("New card") },
                                            onClick = {
                                                addMenuExpanded = false
                                                viewModel.startCreateCipher(VowkeyItemKind.CARD)
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("New API key") },
                                            onClick = {
                                                addMenuExpanded = false
                                                viewModel.startCreateCipher(VowkeyItemKind.KEY)
                                            },
                                        )
                                        DropdownMenuItem(
                                            text = { Text("New note") },
                                            onClick = {
                                                addMenuExpanded = false
                                                viewModel.startCreateCipher(VowkeyItemKind.NOTE)
                                            },
                                        )
                                    }
                                }
                            }
                            VowkeyTab.DOCUMENTS -> {
                                if (state.profiles.isNotEmpty()) {
                                    VowkeyTextButton(
                                        label = "Fill form",
                                        onClick = { viewModel.openFillForm(null) },
                                    )
                                }
                                VowkeyStandardIconButton(
                                    vectorIconRes = VowkeyDrawable.ic_plus,
                                    contentDescription = "Add document",
                                    onClick = { viewModel.openAddDocument(null) },
                                )
                            }
                            else -> Unit
                        }
                    },
                )
            },
            navigationData = ScaffoldNavigationData(
                navigationItems = navItems,
                selectedNavigationItem = state.selectedTab,
                onNavigationClick = { item ->
                    (item as? VowkeyTab)?.let(viewModel::selectTab)
                },
                shouldDimNavigation = false,
            ),
        ) {
            when (state.selectedTab) {
                VowkeyTab.VAULT -> VowkeyVaultTabContent(
                    state = state,
                    viewModel = viewModel,
                )
                VowkeyTab.DOCUMENTS -> VowkeyDocumentsTabContent(
                    state = state,
                    viewModel = viewModel,
                )
                VowkeyTab.AGENTS -> {
                    if (state.isSignedIn) {
                        AgentsTabContent()
                    } else {
                        VowkeySignedOutAgentsTab(onSignInClick = onNavigateToSignIn)
                    }
                }
                VowkeyTab.SETTINGS -> VowkeySettingsTabContent(
                    state = state,
                    viewModel = viewModel,
                    onNavigateToSignIn = onNavigateToSignIn,
                    onNavigateToCreateAccount = onNavigateToCreateAccount,
                    onNavigateToAutofillSettings = onNavigateToAutofillSettings,
                )
            }
        }
    }

    // Modal sheets available from any screen/detail inside the workspace
    if (state.showAddDocument) {
        VowkeyAddDocumentSheet(
            profiles = state.profiles,
            initialProfileId = state.addDocumentTargetProfileId,
            busy = state.busy,
            errorMessage = state.errorBanner,
            onDismissError = viewModel::dismissBanner,
            viewModel = viewModel,
            onDismiss = viewModel::closeAddDocument,
        )
    }

    if (state.showFillForm) {
        VowkeyFillFormSheet(
            profiles = state.profiles,
            initialProfileId = state.fillFormProfileId,
            filledResult = state.filledResult,
            busy = state.busy,
            errorMessage = state.errorBanner,
            hasLoadedForm = state.hasLoadedForm,
            viewModel = viewModel,
            onDismiss = viewModel::closeFillForm,
        )
    }

    state.editingCipher?.let { draft ->
        VowkeyItemEditorSheet(
            draft = draft,
            availableApiKeys = state.items.filter { it.type == CipherType.API_KEY },
            onSave = { updated -> viewModel.saveCipher(updated) },
            onDismiss = viewModel::closeEditor,
        )
    }

    if (state.showTrashSheet) {
        VowkeyRecentlyDeletedSheet(
            deletedItems = state.deletedItems,
            viewModel = viewModel,
            onDismiss = { viewModel.setShowTrashSheet(false) },
        )
    }
}

@Composable
private fun VowkeyVaultTabContent(
    state: VowkeyWorkspaceUiState,
    viewModel: VowkeyWorkspaceViewModel,
) {
    val palette = currentVowkeyPalette()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .standardHorizontalMargin()
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        if (!state.showFillForm && !state.showAddDocument) {
            state.statusBanner?.let { msg ->
                VowkeyStatusBanner(
                    text = msg,
                    onDismiss = viewModel::dismissBanner,
                )
            }
            state.errorBanner?.let { err ->
                Surface(
                    shape = VowkeyTheme.shapes.infoCallout,
                    color = palette.redSoft,
                    border = BorderStroke(1.dp, palette.redBorder),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = err,
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.red,
                            modifier = Modifier.weight(1f),
                        )
                        VowkeyTextButton(label = "Dismiss", onClick = viewModel::dismissBanner)
                    }
                }
            }
        }

        if (state.items.isEmpty()) {
            VowkeyEmptyVaultWalkthrough(viewModel = viewModel, busy = state.busy)
        } else {
            if (state.hasSampleData) {
                VowkeyGroupedCard {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                    ) {
                        VowkeySampleTag(text = "Sample data")
                        VowkeyTextButton(
                            label = "Remove",
                            onClick = viewModel::clearSampleData,
                        )
                    }
                }
            }

            VowkeyTextField(
                label = "Search profiles, documents, logins, keys…",
                value = state.searchQuery,
                onValueChange = viewModel::setSearchQuery,
                cardStyle = CardStyle.Full,
            )

            // Filter & sort bar
            val filterKinds = state.visibleFilterKinds
            val chipShape = RoundedCornerShape(8.dp)
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.horizontalScroll(rememberScrollState()),
            ) {
                filterKinds.forEach { kind ->
                    val selected = state.activeFilter == kind
                    Surface(
                        shape = chipShape,
                        color = if (selected) palette.blueSoft else palette.surface,
                        border = BorderStroke(1.dp, if (selected) palette.blueSoftBorder else palette.line),
                        modifier = Modifier.clickable { viewModel.setActiveFilter(kind) },
                    ) {
                        Text(
                            text = kind.chipLabel,
                            style = VowkeyTheme.typography.labelMedium,
                            color = if (selected) palette.blueInk else palette.ink,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                }
                var sortMenuOpen by remember { mutableStateOf(false) }
                Box {
                    Surface(
                        shape = chipShape,
                        color = palette.surface,
                        border = BorderStroke(1.dp, palette.line),
                        modifier = Modifier.clickable { sortMenuOpen = true },
                    ) {
                        Text(
                            text = "Sort: ${state.sortOrder.label}",
                            style = VowkeyTheme.typography.labelMedium,
                            color = palette.muted,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                    DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                        VowkeySortOrder.entries.forEach { order ->
                            DropdownMenuItem(
                                text = { Text(order.label) },
                                onClick = {
                                    viewModel.setSortOrder(order)
                                    sortMenuOpen = false
                                },
                            )
                        }
                    }
                }
            }

            val visible = state.filteredItems
            if (visible.isEmpty()) {
                VowkeyGroupedCard {
                    Text(
                        text = "No matching items.",
                        style = VowkeyTheme.typography.bodyMedium,
                        color = palette.muted,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            } else if (state.sortOrder != VowkeySortOrder.KIND || state.activeFilter != VowkeyItemKind.ALL) {
                VowkeyCipherSection(
                    title = "${state.activeFilter.chipLabel} (${visible.size})",
                    items = visible,
                    onOpen = { viewModel.openCipherDetail(it.id) },
                )
            } else {
                val pinned = visible.filter { it.favorite }
                val unpinned = visible.filterNot { it.favorite }
                if (pinned.isNotEmpty()) {
                    VowkeyCipherSection(
                        title = "Pinned",
                        items = pinned,
                        onOpen = { viewModel.openCipherDetail(it.id) },
                    )
                }
                val sections = listOf(
                    "Profiles" to unpinned.filter { it.type == CipherType.IDENTITY },
                    "Logins" to unpinned.filter { it.type == CipherType.LOGIN },
                    "Cards" to unpinned.filter { it.type == CipherType.CARD },
                    "API keys" to unpinned.filter { it.type == CipherType.API_KEY },
                    "Environments" to unpinned.filter { it.type == CipherType.ENVIRONMENT },
                    "Notes" to unpinned.filter { it.type == CipherType.SECURE_NOTE },
                )
                sections.forEach { (heading, list) ->
                    if (list.isNotEmpty()) {
                        VowkeyCipherSection(
                            title = heading,
                            items = list,
                            onOpen = { viewModel.openCipherDetail(it.id) },
                        )
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
    }
}

@Composable
private fun VowkeyEmptyVaultWalkthrough(viewModel: VowkeyWorkspaceViewModel, busy: Boolean) {
    val palette = currentVowkeyPalette()
    var sampleMenuExpanded by remember { mutableStateOf(false) }

    VowkeyGroupedCard {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
        ) {
            VowkeyBrandHeader(horizontalArrangement = Arrangement.Start)
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = "Save once, fill any form",
                    style = VowkeyTheme.typography.headlineSmall,
                    color = palette.ink,
                )
                Text(
                    text = "Add a document, check its details, and use them to fill your next form.",
                    style = VowkeyTheme.typography.bodyMedium,
                    color = palette.muted,
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                VowkeyFilledButton(
                    label = "Add a document",
                    onClick = { viewModel.openAddDocument(null) },
                    isEnabled = !busy,
                    modifier = Modifier.fillMaxWidth(),
                )

                Box {
                    VowkeyOutlinedButton(
                        label = "Try sample documents",
                        onClick = { sampleMenuExpanded = true },
                        isEnabled = !busy,
                        modifier = Modifier.fillMaxWidth(),
                    )
                    DropdownMenu(
                        expanded = sampleMenuExpanded,
                        onDismissRequest = { sampleMenuExpanded = false },
                    ) {
                        VowkeySampleWalkthrough.scenarios.forEach { scenario ->
                            DropdownMenuItem(
                                text = { Text(scenario.chipTitle) },
                                onClick = {
                                    sampleMenuExpanded = false
                                    viewModel.loadSampleScenario(scenario)
                                },
                            )
                        }
                        HorizontalDivider(color = palette.line)
                        DropdownMenuItem(
                            text = { Text("Load all samples") },
                            onClick = {
                                sampleMenuExpanded = false
                                viewModel.loadAllSamples()
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun VowkeyCipherSection(
    title: String,
    items: List<CipherView>,
    onOpen: (CipherView) -> Unit,
) {
    val palette = currentVowkeyPalette()
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        VowkeySectionLabel(title)
        VowkeyGroupedCard {
            items.forEachIndexed { idx, cipher ->
                if (idx > 0) {
                    HorizontalDivider(
                        color = palette.line,
                        modifier = Modifier.padding(start = 66.dp),
                    )
                }
                val isSample = VowkeySampleWalkthrough.isSampleCipher(cipher)
                val cleanName = VowkeyMobileFormat.displayName(cipher.name)
                val kind = VowkeyProfileParser.kindForCipher(cipher)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onOpen(cipher) }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    if (cipher.type == CipherType.IDENTITY) {
                        VowkeyMonogramTile(name = cleanName, size = 38.dp, highlighted = true)
                    } else {
                        VowkeyKindTile(kind = kind, size = 38.dp)
                    }
                    Column(modifier = Modifier.weight(1f)) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Text(
                                text = cleanName,
                                style = VowkeyTheme.typography.bodyLargeEmphasis,
                                color = palette.ink,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                modifier = Modifier.weight(1f, fill = false),
                            )
                            if (isSample) {
                                VowkeySampleTag()
                            }
                        }
                        Text(
                            text = VowkeyProfileParser.subtitleForCipher(cipher),
                            style = VowkeyTheme.typography.bodySmall,
                            color = palette.muted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    Icon(
                        painter = painterResource(VowkeyDrawable.ic_chevron_right),
                        contentDescription = null,
                        tint = palette.muted,
                        modifier = Modifier.size(18.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun VowkeySignedOutAgentsTab(onSignInClick: () -> Unit) {
    val palette = currentVowkeyPalette()
    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .standardHorizontalMargin()
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        VowkeyGroupedCard {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(14.dp),
            ) {
                VowkeyKindTile(kind = VowkeyItemKind.AGENT, size = 44.dp)
                Text(
                    text = "Approve AI agent requests from your phone",
                    style = VowkeyTheme.typography.headlineSmall,
                    color = palette.ink,
                )
                Text(
                    text = "Pair desktop or CLI AI agents so they can request specific profile details or @vk: API key handles without ever seeing raw secrets unless you approve.",
                    style = VowkeyTheme.typography.bodyMedium,
                    color = palette.muted,
                )

                val bullets = listOf(
                    "Review exactly which details or site an AI agent is asking for",
                    "Allow once, allow for a specific domain, or deny in one tap",
                    "Revoke paired desktop agents or site grants anytime",
                )
                bullets.forEach { line ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Icon(
                            painter = painterResource(VowkeyDrawable.ic_check_mark),
                            contentDescription = null,
                            tint = palette.iconSecondary,
                            modifier = Modifier.size(16.dp),
                        )
                        Text(
                            text = line,
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.ink,
                        )
                    }
                }

                VowkeyFilledButton(
                    label = "Sign in to pair AI agents",
                    onClick = onSignInClick,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

@Composable
private fun VowkeySettingsTabContent(
    state: VowkeyWorkspaceUiState,
    viewModel: VowkeyWorkspaceViewModel,
    onNavigateToSignIn: () -> Unit,
    onNavigateToCreateAccount: () -> Unit,
    onNavigateToAutofillSettings: (() -> Unit)?,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .standardHorizontalMargin()
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(18.dp),
    ) {
        // Account & sync
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            VowkeySectionLabel("Account & sync")
            if (state.isSignedIn) {
                VowkeyPushRow(
                    text = state.activeEmail ?: "Signed in",
                    description = "End-to-end encrypted sync active",
                    onClick = {},
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_check_mark),
                    cardStyle = CardStyle.Top(dividerPadding = 48.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                VowkeyPushRow(
                    text = "Sync now",
                    onClick = viewModel::syncNow,
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_check_mark),
                    cardStyle = CardStyle.Middle(dividerPadding = 48.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                VowkeyPushRow(
                    text = "Lock vault",
                    onClick = viewModel::lockCurrentVault,
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_locked),
                    cardStyle = CardStyle.Middle(dividerPadding = 48.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                VowkeyPushRow(
                    text = "Sign out",
                    onClick = viewModel::signOut,
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_close),
                    cardStyle = CardStyle.Bottom,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                VowkeyPushRow(
                    text = "Sign in to sync",
                    description = "Local-only vault active on this device",
                    onClick = onNavigateToSignIn,
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_locked),
                    cardStyle = CardStyle.Top(dividerPadding = 48.dp),
                    modifier = Modifier.fillMaxWidth(),
                )
                VowkeyPushRow(
                    text = "Create account",
                    onClick = onNavigateToCreateAccount,
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_plus),
                    cardStyle = CardStyle.Bottom,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // AI & privacy
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            VowkeySectionLabel("AI & privacy")
            VowkeySwitch(
                label = "On-device only",
                subtext = "Run OCR and form matching locally on this phone without sending images to cloud AI.",
                isChecked = state.onDeviceOnly,
                onCheckedChange = viewModel::setOnDeviceOnly,
                cardStyle = CardStyle.Full,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // Autofill & security
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            VowkeySectionLabel("Autofill & security")
            VowkeyPushRow(
                text = "Autofill service",
                description = "Fill logins, cards, and profiles across apps",
                onClick = {
                    if (onNavigateToAutofillSettings != null) {
                        onNavigateToAutofillSettings()
                    } else {
                        runCatching {
                            val intent = Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
                                data = "package:${context.packageName}".toUri()
                            }
                            context.startActivity(intent)
                        }.onFailure {
                            runCatching { context.startActivity(Intent(Settings.ACTION_SETTINGS)) }
                        }
                    }
                },
                leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_check_mark),
                cardStyle = CardStyle.Full,
                modifier = Modifier.fillMaxWidth(),
            )
        }

        // Data
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            VowkeySectionLabel("Data")
            val hasSample = state.hasSampleData
            VowkeyPushRow(
                text = "Recently deleted (${state.deletedItems.size})",
                onClick = { viewModel.setShowTrashSheet(true) },
                leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_trash),
                cardStyle = if (hasSample) CardStyle.Top(dividerPadding = 48.dp) else CardStyle.Full,
                modifier = Modifier.fillMaxWidth(),
            )
            if (hasSample) {
                VowkeyPushRow(
                    text = "Remove sample data",
                    onClick = viewModel::clearSampleData,
                    leadingIcon = IconData.Local(iconRes = VowkeyDrawable.ic_delete),
                    cardStyle = CardStyle.Bottom,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        // Appearance
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            VowkeySectionLabel("Appearance")
            VowkeyGroupedCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    val options = listOf(
                        AppTheme.DEFAULT to "System",
                        AppTheme.LIGHT to "Light",
                        AppTheme.DARK to "Dark",
                    )
                    options.forEach { (theme, label) ->
                        val selected = state.appTheme == theme
                        Surface(
                            shape = VowkeyTheme.shapes.content,
                            color = if (selected) palette.blueSoft else palette.surfaceSubtle,
                            border = BorderStroke(
                                1.dp,
                                if (selected) palette.blueSoftBorder else palette.line,
                            ),
                            modifier = Modifier
                                .weight(1f)
                                .clickable { viewModel.setAppTheme(theme) },
                        ) {
                            Text(
                                text = label,
                                style = VowkeyTheme.typography.labelMedium,
                                color = if (selected) palette.blueInk else palette.ink,
                                textAlign = TextAlign.Center,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 10.dp),
                            )
                        }
                    }
                }
            }
        }

        // About
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            VowkeySectionLabel("About")
            VowkeyGroupedCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    VowkeyBrandHeader(horizontalArrangement = Arrangement.Start)
                    Text(
                        text = "v${BuildConfig.VERSION_NAME}",
                        style = VowkeyTheme.typography.labelMedium,
                        color = palette.muted,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))
    }
}
