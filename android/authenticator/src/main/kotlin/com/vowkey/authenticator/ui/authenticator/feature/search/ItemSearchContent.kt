package com.vowkey.authenticator.ui.authenticator.feature.search

import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.authenticator.ui.authenticator.feature.search.handlers.SearchHandlers
import com.vowkey.authenticator.ui.platform.components.listitem.VaultVerificationCodeItem
import com.vowkey.authenticator.ui.platform.components.listitem.model.SharedCodesDisplayState
import com.vowkey.authenticator.ui.platform.components.listitem.model.VaultDropdownMenuAction
import com.vowkey.authenticator.ui.platform.components.listitem.model.VerificationCodeDisplayItem
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toListItemCardStyle
import com.vowkey.ui.platform.components.header.VowkeyListHeaderText
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * The content state for the item search screen.
 */
@Composable
fun ItemSearchContent(
    viewState: ItemSearchState.ViewState.Content,
    searchHandlers: SearchHandlers,
    modifier: Modifier = Modifier,
) {
    LazyColumn(modifier = modifier) {
        item {
            Spacer(Modifier.height(height = 12.dp))
        }

        if (viewState.hasLocalAndSharedItems) {
            item {
                VowkeyListHeaderText(
                    label = viewState.localListHeader(),
                    modifier = Modifier
                        .fillMaxWidth()
                        .standardHorizontalMargin()
                        .padding(horizontal = 16.dp),
                )
                Spacer(Modifier.height(height = 8.dp))
            }
        }

        itemsIndexed(viewState.itemList) { index, item ->
            VaultVerificationCodeItem(
                displayItem = item,
                onItemClick = { searchHandlers.onItemClick(item.authCode) },
                onDropdownMenuClick = { searchHandlers.onDropdownMenuClick(it, item) },
                cardStyle = viewState.itemList.toListItemCardStyle(index = index),
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
        }

        if (viewState.hasLocalAndSharedItems) {
            item {
                Spacer(Modifier.height(height = 12.dp))
            }
        }

        sharedCodes(
            sharedItems = viewState.sharedItems,
            onCopyClick = searchHandlers.onItemClick,
            onDropdownMenuClick = searchHandlers.onDropdownMenuClick,
        )

        item {
            Spacer(modifier = Modifier.height(height = 16.dp))
            Spacer(modifier = Modifier.navigationBarsPadding())
        }
    }
}

private fun LazyListScope.sharedCodes(
    sharedItems: SharedCodesDisplayState,
    onCopyClick: (authCode: String) -> Unit,
    onDropdownMenuClick: (VaultDropdownMenuAction, VerificationCodeDisplayItem) -> Unit,
) {
    when (sharedItems) {
        is SharedCodesDisplayState.Codes -> {
            sharedItems.sections.forEach { section ->
                item {
                    VowkeyListHeaderText(
                        label = section.label(),
                        modifier = Modifier
                            .fillMaxWidth()
                            .standardHorizontalMargin()
                            .padding(horizontal = 16.dp),
                    )
                    Spacer(Modifier.height(height = 12.dp))
                }

                itemsIndexed(section.codes) { index, item ->
                    VaultVerificationCodeItem(
                        displayItem = item,
                        onItemClick = { onCopyClick(item.authCode) },
                        onDropdownMenuClick = { onDropdownMenuClick(it, item) },
                        cardStyle = section.codes.toListItemCardStyle(index = index),
                        modifier = Modifier
                            .fillMaxWidth()
                            .standardHorizontalMargin(),
                    )
                }
            }
        }

        SharedCodesDisplayState.Error -> {
            item {
                Text(
                    text = stringResource(VowkeyString.shared_codes_error),
                    color = VowkeyTheme.colorScheme.text.secondary,
                    style = VowkeyTheme.typography.bodySmall,
                    modifier = Modifier.standardHorizontalMargin(),
                )
            }
        }
    }
}
