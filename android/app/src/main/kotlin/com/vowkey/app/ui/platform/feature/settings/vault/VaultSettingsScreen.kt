package com.vowkey.app.ui.platform.feature.settings.vault

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.mirrorIfRtl
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.badge.NotificationBadge
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.card.actionCardExitAnimation
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.row.VowkeyTextRow
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.platform.composition.util.vfo1Foundation

/**
 * Displays the vault settings screen.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VaultSettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToExportVault: () -> Unit,
    onNavigateToFolders: () -> Unit,
    onNavigateToImportLogins: () -> Unit,
    onNavigateToImportItems: () -> Unit,
    viewModel: VaultSettingsViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()

    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            VaultSettingsEvent.NavigateBack -> onNavigateBack()
            VaultSettingsEvent.NavigateToExportVault -> onNavigateToExportVault()
            VaultSettingsEvent.NavigateToFolders -> onNavigateToFolders()
            is VaultSettingsEvent.NavigateToImportVault -> onNavigateToImportLogins()
            is VaultSettingsEvent.NavigateToImportItems -> onNavigateToImportItems()
            is VaultSettingsEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.vault),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_back),
                navigationIconContentDescription = stringResource(id = VowkeyString.back),
                onNavigationIconClick = { viewModel.trySendAction(VaultSettingsAction.BackClick) },
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(
                vowkeyHostState = snackbarHostState,
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState()),
        ) {
            Spacer(modifier = Modifier.height(12.dp))
            AnimatedVisibility(
                visible = state.showImportActionCard,
                label = "ImportLoginsActionCard",
                exit = actionCardExitAnimation(),
            ) {
                VowkeyActionCard(
                    cardTitle = stringResource(id = VowkeyString.import_saved_logins),
                    actionButton = VowkeyButtonData(
                        label = VowkeyString.get_started.asText(),
                        onClick = {
                            viewModel.trySendAction(VaultSettingsAction.ImportLoginsCardCtaClick)
                        },
                    ),
                    cardSubtitle = stringResource(VowkeyString.use_a_computer_to_import_logins),
                    onDismissClick = {
                        viewModel.trySendAction(VaultSettingsAction.ImportLoginsCardDismissClick)
                    },
                    leadingContent = {
                        NotificationBadge(notificationCount = 1)
                    },
                    modifier = Modifier
                        .standardHorizontalMargin()
                        .padding(bottom = 16.dp),
                )
            }
            VowkeyTextRow(
                text = stringResource(
                    id = vfo1Foundation(VowkeyString.my_folders, VowkeyString.folders),
                ),
                onClick = { viewModel.trySendAction(VaultSettingsAction.FoldersButtonClick) },
                withDivider = false,
                cardStyle = CardStyle.Top(),
                modifier = Modifier
                    .testTag("FoldersLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            VowkeyTextRow(
                text = stringResource(VowkeyString.export_vault),
                onClick = { viewModel.trySendAction(VaultSettingsAction.ExportVaultClick) },
                withDivider = false,
                cardStyle = CardStyle.Middle(),
                modifier = Modifier
                    .testTag("ExportVaultLabel")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            VowkeyTextRow(
                text = stringResource(VowkeyString.import_items),
                onClick = { viewModel.trySendAction(VaultSettingsAction.ImportItemsClick) },
                withDivider = false,
                cardStyle = CardStyle.Bottom,
                modifier = Modifier
                    .testTag("ImportItemsLinkItemView")
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            ) {
                if (state.showImportItemsChevron) {
                    Icon(
                        painter = rememberVectorPainter(id = VowkeyDrawable.ic_chevron_right),
                        contentDescription = null,
                        tint = VowkeyTheme.colorScheme.icon.primary,
                        modifier = Modifier
                            .mirrorIfRtl()
                            .size(size = 16.dp),
                    )
                }
            }
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
