package com.vowkey.app.ui.vault.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.composition.util.vfo1Foundation
import com.vowkey.app.ui.vault.model.VaultCollection

/**
 * A set of switches that a user can select [Collection]s with.
 */
@Suppress("LongMethod")
fun LazyListScope.collectionItemsSelector(
    collectionList: List<VaultCollection>?,
    onCollectionSelect: (VaultCollection) -> Unit,
    isCollectionsTitleVisible: Boolean = false,
) {
    if (isCollectionsTitleVisible) {
        item {
            VowkeyListHeaderText(
                label = stringResource(
                    id = vfo1Foundation(
                        new = VowkeyString.shared_folders,
                        old = VowkeyString.collections,
                    ),
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin()
                    .padding(horizontal = 16.dp),
            )
            Spacer(modifier = Modifier.height(height = 8.dp))
        }
    }

    if (collectionList?.isNotEmpty() == true) {
        itemsIndexed(collectionList) { index, it ->
            VowkeySwitch(
                label = it.name,
                isChecked = it.isSelected,
                onCheckedChange = { _ ->
                    onCollectionSelect(it)
                },
                cardStyle = if (isCollectionsTitleVisible) {
                    // The header is present so display all collections as a single card.
                    collectionList.toListItemCardStyle(index = index)
                } else if (collectionList.size == 1 || index == collectionList.size - 1) {
                    // No header, and this is the last item.
                    CardStyle.Bottom
                } else {
                    // No header, and this is not the last item.
                    CardStyle.Middle()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .testTag("CollectionItemCell")
                    .standardHorizontalMargin(),
            )
        }
    } else {
        item {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            ) {
                Text(
                    text = stringResource(
                        id = vfo1Foundation(
                            new = VowkeyString.there_are_no_shared_folders_to_list,
                            old = VowkeyString.no_collections_to_list,
                        ),
                    ),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.text.primary,
                )
            }
        }
    }
}
