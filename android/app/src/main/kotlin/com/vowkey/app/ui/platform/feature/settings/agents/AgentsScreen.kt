package com.vowkey.app.ui.platform.feature.settings.agents

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavGraphBuilder
import androidx.navigation.compose.composable
import com.vowkey.app.R
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
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
    var selected by remember { mutableStateOf<String?>(null) }
    val request = state.requests.firstOrNull { it.id == selected }
    VowkeyScaffold(topBar = {
        VowkeyMediumTopAppBar(
            title = stringResource(R.string.vk_agents),
            navigationIcon = NavigationIcon(
                navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(VowkeyString.close),
                onNavigationIconClick = onBack,
            ),
        )
    }) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (state.loading) CircularProgressIndicator()
            if (state.locked) Text(stringResource(R.string.vk_agents_unlock))
            state.error?.let { Text(stringResource(when (it) {
                AgentsError.LOAD -> R.string.vk_agents_load_error
                AgentsError.SAVE -> R.string.vk_agents_save_error
                AgentsError.RESOLVED -> R.string.vk_agents_resolved
                AgentsError.EXPIRED -> R.string.vk_agents_expired
                AgentsError.INVALID_SELECTION -> R.string.vk_agents_selection_error
            })) }
            if (!state.locked) {
                OutlinedButton(onClick = model::refresh, enabled = !state.busy) {
                    Text(stringResource(R.string.vk_agents_refresh))
                }
                Text(stringResource(R.string.vk_agents_waiting))
                val pending = state.requests.filter { it.pending }
                if (!state.loading && pending.isEmpty()) Text(stringResource(R.string.vk_agents_no_requests))
                pending.forEach { item ->
                    TextButton(onClick = { selected = item.id }, enabled = !state.busy,
                        modifier = Modifier.fillMaxWidth()) {
                        Column(Modifier.fillMaxWidth()) {
                            Text(item.agentName)
                            Text(item.routing.text("targetDisplay"))
                        }
                    }
                }
                Text(stringResource(R.string.vk_agents_connected))
                if (state.pairings.isEmpty()) Text(stringResource(R.string.vk_agents_no_agents))
                state.pairings.forEach { pairing ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(pairing.payload.text("displayName"), Modifier.weight(1f))
                        TextButton(onClick = { model.revokePairing(pairing.row.text("pairingId")) },
                            enabled = !state.busy) { Text(stringResource(R.string.vk_agents_revoke)) }
                    }
                }
                Text(stringResource(R.string.vk_agents_allowed_sites))
                if (state.grants.isEmpty()) Text(stringResource(R.string.vk_agents_no_sites))
                state.grants.forEach { grant ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text(grant.payload.text("destinationKey"), Modifier.weight(1f))
                        TextButton(onClick = { model.revokeGrant(grant.row.text("grantId")) },
                            enabled = !state.busy) { Text(stringResource(R.string.vk_agents_revoke)) }
                    }
                }
                val answered = state.requests.filterNot { it.pending }
                if (answered.isNotEmpty()) {
                    Text(stringResource(R.string.vk_agents_recent))
                    answered.forEach {
                        Column {
                            Text(it.agentName)
                            Text(stringResource(when {
                                it.row.text("status") == "timed_out" -> R.string.vk_agents_expired
                                it.answer == "deny" -> R.string.vk_agents_denied
                                it.answer != null -> R.string.vk_agents_answered
                                else -> R.string.vk_agents_finished
                            }))
                        }
                    }
                }
            }
        }
    }
    if (request != null) {
        AlertDialog(
            onDismissRequest = { if (!state.busy) selected = null },
            title = { Text(request.agentName) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(request.routing.text("targetDisplay"))
                    request.note?.let {
                        Text(stringResource(R.string.vk_agents_goal, it.text("goal")))
                        Text(stringResource(R.string.vk_agents_note, it.text("reason")))
                    }
                    request.sections.forEach { (sectionId, label) ->
                        Text(label)
                        val entries = request.entries.filter { it.sectionId == sectionId }
                        entries.forEach { entry ->
                            Row {
                                Checkbox(checked = entry.id in request.selected, enabled = !state.busy,
                                    onCheckedChange = { model.select(request.id, entry.id, it) })
                                Text(entry.label, Modifier.padding(top = 12.dp))
                            }
                        }
                        val boundProfiles = entries.mapNotNull { it.profileId }.distinct()
                        boundProfiles.forEach { id ->
                            Text(state.profiles.firstOrNull { it.first == id }?.second
                                ?: stringResource(R.string.vk_agents_profile_unavailable))
                        }
                        if (entries.any { it.profileId == null && it.fieldPath.startsWith("detail.") }) {
                            ProfilePicker(state, request, sectionId) {
                                model.selectProfile(request.id, sectionId, it)
                            }
                        }
                    }
                    state.error?.let { Text(stringResource(when (it) {
                        AgentsError.INVALID_SELECTION -> R.string.vk_agents_selection_error
                        AgentsError.EXPIRED -> R.string.vk_agents_expired
                        AgentsError.RESOLVED -> R.string.vk_agents_resolved
                        else -> R.string.vk_agents_save_error
                    })) }
                }
            },
            confirmButton = {
                Column {
                    TextButton(onClick = { model.answer(request.id, "allow_once") },
                        enabled = request.pending && !state.busy) {
                        Text(stringResource(R.string.vk_agents_allow_once))
                    }
                    TextButton(onClick = { model.answer(request.id, "always_allow") },
                        enabled = request.pending && !state.busy) {
                        Text(stringResource(R.string.vk_agents_always_allow))
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { model.answer(request.id, "deny") },
                    enabled = request.pending && !state.busy) {
                    Text(stringResource(R.string.vk_agents_deny))
                }
            },
        )
    }
}

@Composable
private fun ProfilePicker(state: AgentsState, request: AgentRequest, sectionId: String,
    onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        OutlinedButton(onClick = { expanded = true }, enabled = !state.busy) {
            Text(state.profiles.firstOrNull { it.first == request.profiles[sectionId] }?.second
                ?: stringResource(R.string.vk_agents_choose_profile))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            state.profiles.forEach { (id, name) ->
                DropdownMenuItem(text = { Text(name) }, onClick = { onSelect(id); expanded = false })
            }
        }
    }
}
