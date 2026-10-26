package com.vowkey.app.ui.vault.feature.movetoorganization

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.dropdown.VowkeyMultiSelectButton
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.app.ui.platform.composition.util.vfo1Foundation
import com.vowkey.app.ui.vault.components.collectionItemsSelector
import com.vowkey.app.ui.vault.model.VaultCollection
import kotlinx.collections.immutable.toImmutableList

/**
 * Content view for the [VaultMoveToOrganizationScreen].
 */
@Composable
fun VaultMoveToOrganizationContent(
    state: VaultMoveToOrganizationState.ViewState.Content,
    showOnlyCollections: Boolean,
    organizationSelect: (VaultMoveToOrganizationState.ViewState.Content.Organization) -> Unit,
    collectionSelect: (VaultCollection) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        modifier = modifier.testTag("CollectionListContainer"),
    ) {
        item {
            Spacer(modifier = Modifier.height(height = 12.dp))
        }
        if (!showOnlyCollections) {
            item {
                VowkeyMultiSelectButton(
                    label = stringResource(
                        id = vfo1Foundation(VowkeyString.vault, VowkeyString.organization),
                    ),
                    options = state
                        .organizations
                        .map { it.name }
                        .toImmutableList(),
                    selectedOption = state.selectedOrganization.name,
                    onOptionSelected = { selectedString ->
                        organizationSelect(
                            state
                                .organizations
                                .first { it.name == selectedString },
                        )
                    },
                    supportingText = stringResource(
                        id = vfo1Foundation(
                            new = VowkeyString.move_to_vault_desc,
                            old = VowkeyString.move_to_org_desc,
                        ),
                    ),
                    cardStyle = CardStyle.Full,
                    modifier = Modifier
                        .testTag("OrganizationListDropdown")
                        .fillMaxWidth()
                        .standardHorizontalMargin(),
                )
                Spacer(modifier = Modifier.height(height = 16.dp))
            }
        }

        collectionItemsSelector(
            collectionList = state.selectableCollections,
            onCollectionSelect = collectionSelect,
            isCollectionsTitleVisible = !showOnlyCollections,
        )

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}
