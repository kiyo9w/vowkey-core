package com.vowkey.app.ui.platform.feature.settings.agents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.vowkey.app.R
import com.vowkey.app.ui.vowkey.VowkeyGroupedCard
import com.vowkey.app.ui.vowkey.VowkeySectionLabel
import com.vowkey.app.ui.vowkey.currentVowkeyPalette
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.serialization.Serializable

@Serializable
data object AgentsRoute

fun NavGraphBuilder.agentsDestination(onBack: () -> Unit) {
    composable<AgentsRoute> { AgentsScreen(onBack = onBack) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AgentsScreen(onBack: () -> Unit, model: AgentsViewModel = hiltViewModel()) {
    val state by model.state.collectAsStateWithLifecycle()
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyMediumTopAppBar(
                title = stringResource(R.string.vk_agents),
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
                    navigationIconContentDescription = stringResource(VowkeyString.close),
                    onNavigationIconClick = onBack,
                ),
                actions = {
                    if (!state.locked) {
                        VowkeyStandardIconButton(
                            vectorIconRes = VowkeyDrawable.ic_refresh,
                            contentDescription = stringResource(R.string.vk_agents_refresh),
                            onClick = model::refresh,
                            isEnabled = !state.busy,
                        )
                    }
                },
            )
        },
    ) {
        AgentsTabContent(model = model)
    }
}

@Composable
internal fun AgentsTabContent(
    modifier: Modifier = Modifier,
    model: AgentsViewModel = hiltViewModel(),
) {
    val palette = currentVowkeyPalette()
    val state by model.state.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<String?>(null) }
    val request = state.requests.firstOrNull { it.id == selected }

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .standardHorizontalMargin()
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (state.loading) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(
                    stringResource(R.string.vk_working),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = palette.muted,
                )
            }
        }
        if (state.locked) {
            VowkeyGroupedCard {
                Text(
                    stringResource(R.string.vk_agents_unlock),
                    style = VowkeyTheme.typography.bodyLarge,
                    color = palette.muted,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
        state.error?.let { err ->
            VowkeyGroupedCard {
                Text(
                    stringResource(
                        when (err) {
                            AgentsError.LOAD -> R.string.vk_agents_load_error
                            AgentsError.SAVE -> R.string.vk_agents_save_error
                            AgentsError.RESOLVED -> R.string.vk_agents_resolved
                            AgentsError.EXPIRED -> R.string.vk_agents_expired
                            AgentsError.INVALID_SELECTION -> R.string.vk_agents_selection_error
                        },
                    ),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = palette.red,
                    modifier = Modifier.padding(16.dp),
                )
            }
        }
        if (!state.locked) {
            VowkeyOutlinedButton(
                label = stringResource(R.string.vk_agents_refresh),
                onClick = model::refresh,
                isEnabled = !state.busy,
            )

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                VowkeySectionLabel(stringResource(R.string.vk_agents_waiting))
                val pending = state.requests.filter { it.pending }
                VowkeyGroupedCard {
                    if (!state.loading && pending.isEmpty()) {
                        Text(
                            stringResource(R.string.vk_agents_no_requests),
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.muted,
                            modifier = Modifier.padding(16.dp),
                        )
                    } else {
                        pending.forEachIndexed { idx, item ->
                            if (idx > 0) HorizontalDivider(color = palette.line)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        item.agentName,
                                        style = VowkeyTheme.typography.titleSmall,
                                        color = palette.ink,
                                    )
                                    Text(
                                        item.routing.text("targetDisplay"),
                                        style = VowkeyTheme.typography.bodySmall,
                                        color = palette.muted,
                                    )
                                }
                                VowkeyTextButton(
                                    label = "Review",
                                    onClick = { selected = item.id },
                                    isEnabled = !state.busy,
                                )
                            }
                        }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                VowkeySectionLabel(stringResource(R.string.vk_agents_connected))
                VowkeyGroupedCard {
                    if (state.pairings.isEmpty()) {
                        Text(
                            stringResource(R.string.vk_agents_no_agents),
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.muted,
                            modifier = Modifier.padding(16.dp),
                        )
                    } else {
                        state.pairings.forEachIndexed { idx, pairing ->
                            if (idx > 0) HorizontalDivider(color = palette.line)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    pairing.payload.text("displayName"),
                                    style = VowkeyTheme.typography.bodyLarge,
                                    color = palette.ink,
                                    modifier = Modifier.weight(1f),
                                )
                                VowkeyTextButton(
                                    label = stringResource(R.string.vk_agents_revoke),
                                    onClick = { model.revokePairing(pairing.row.text("pairingId")) },
                                    isEnabled = !state.busy,
                                )
                            }
                        }
                    }
                }
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                VowkeySectionLabel(stringResource(R.string.vk_agents_allowed_sites))
                VowkeyGroupedCard {
                    if (state.grants.isEmpty()) {
                        Text(
                            stringResource(R.string.vk_agents_no_sites),
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.muted,
                            modifier = Modifier.padding(16.dp),
                        )
                    } else {
                        state.grants.forEachIndexed { idx, grant ->
                            if (idx > 0) HorizontalDivider(color = palette.line)
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 10.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    grant.payload.text("destinationKey"),
                                    style = VowkeyTheme.typography.bodyLarge,
                                    color = palette.ink,
                                    modifier = Modifier.weight(1f),
                                )
                                VowkeyTextButton(
                                    label = stringResource(R.string.vk_agents_revoke),
                                    onClick = { model.revokeGrant(grant.row.text("grantId")) },
                                    isEnabled = !state.busy,
                                )
                            }
                        }
                    }
                }
            }

            val answered = state.requests.filterNot { it.pending }
            if (answered.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    VowkeySectionLabel(stringResource(R.string.vk_agents_recent))
                    VowkeyGroupedCard {
                        answered.forEachIndexed { idx, item ->
                            if (idx > 0) HorizontalDivider(color = palette.line)
                            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                                Text(
                                    item.agentName,
                                    style = VowkeyTheme.typography.bodyLarge,
                                    color = palette.ink,
                                )
                                Text(
                                    stringResource(
                                        when {
                                            item.row.text("status") == "timed_out" -> R.string.vk_agents_expired
                                            item.answer == "deny" -> R.string.vk_agents_denied
                                            item.answer != null -> R.string.vk_agents_answered
                                            else -> R.string.vk_agents_finished
                                        },
                                    ),
                                    style = VowkeyTheme.typography.bodySmall,
                                    color = palette.muted,
                                )
                            }
                        }
                    }
                }
            }
        }
        Spacer(modifier = Modifier.height(16.dp))
    }

    if (request != null) {
        AlertDialog(
            onDismissRequest = { if (!state.busy) selected = null },
            title = { Text(request.agentName, style = VowkeyTheme.typography.titleMedium) },
            text = {
                Column(
                    Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Text(request.routing.text("targetDisplay"), style = VowkeyTheme.typography.bodyMedium)
                    request.note?.let {
                        Text(stringResource(R.string.vk_agents_goal, it.text("goal")))
                        Text(stringResource(R.string.vk_agents_note, it.text("reason")))
                    }
                    request.sections.forEach { (sectionId, label) ->
                        Text(label, style = VowkeyTheme.typography.labelMedium)
                        val entries = request.entries.filter { it.sectionId == sectionId }
                        entries.forEach { entry ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Checkbox(
                                    checked = entry.id in request.selected,
                                    enabled = !state.busy,
                                    onCheckedChange = { model.select(request.id, entry.id, it) },
                                )
                                Text(entry.label)
                            }
                        }
                        val boundProfiles = entries.mapNotNull { it.profileId }.distinct()
                        boundProfiles.forEach { id ->
                            Text(
                                state.profiles.firstOrNull { it.first == id }?.second
                                    ?: stringResource(R.string.vk_agents_profile_unavailable),
                            )
                        }
                        if (entries.any { it.profileId == null && it.fieldPath.startsWith("detail.") }) {
                            ProfilePicker(state, request, sectionId) {
                                model.selectProfile(request.id, sectionId, it)
                            }
                        }
                    }
                    state.error?.let {
                        Text(
                            stringResource(
                                when (it) {
                                    AgentsError.INVALID_SELECTION -> R.string.vk_agents_selection_error
                                    AgentsError.EXPIRED -> R.string.vk_agents_expired
                                    AgentsError.RESOLVED -> R.string.vk_agents_resolved
                                    else -> R.string.vk_agents_save_error
                                },
                            ),
                            color = palette.red,
                        )
                    }
                }
            },
            confirmButton = {
                Column {
                    TextButton(
                        onClick = { model.answer(request.id, "allow_once") },
                        enabled = request.pending && !state.busy,
                    ) {
                        Text(stringResource(R.string.vk_agents_allow_once))
                    }
                    TextButton(
                        onClick = { model.answer(request.id, "always_allow") },
                        enabled = request.pending && !state.busy,
                    ) {
                        Text(stringResource(R.string.vk_agents_always_allow))
                    }
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { model.answer(request.id, "deny") },
                    enabled = request.pending && !state.busy,
                ) {
                    Text(stringResource(R.string.vk_agents_deny))
                }
            },
        )
    }
}

@Composable
private fun ProfilePicker(
    state: AgentsState,
    request: AgentRequest,
    sectionId: String,
    onSelect: (String) -> Unit,
) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        VowkeyOutlinedButton(
            label = state.profiles.firstOrNull { it.first == request.profiles[sectionId] }?.second
                ?: stringResource(R.string.vk_agents_choose_profile),
            onClick = { expanded = true },
            isEnabled = !state.busy,
        )
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            state.profiles.forEach { (id, name) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { onSelect(id); expanded = false })
            }
        }
    }
}
