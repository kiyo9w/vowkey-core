package com.vowkey.app.ui.vault.feature.exportitems.component

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vowkey.ui.R
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.hexToColor
import com.vowkey.ui.platform.base.util.toSafeOverlayColor
import com.vowkey.ui.platform.base.util.toUnscaledTextUnit
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.vault.feature.exportitems.model.AccountSelectionListItem

/**
 * A composable that displays an account summary list item.
 *
 * @param item The account selection list item to display.
 * @param cardStyle The card style to apply to the list item.
 * @param modifier The modifier to apply to the list item.
 * @param clickable Whether the list item should be clickable.
 */
@Suppress("LongMethod")
@Composable
fun AccountSummaryListItem(
    item: AccountSelectionListItem,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
    clickable: Boolean,
    onClick: (userId: String) -> Unit = {},
) {
    Row(
        modifier = modifier
            .testTag("AccountSummaryListItem")
            .defaultMinSize(minHeight = 60.dp)
            .clickable(
                onClick = { onClick(item.userId) },
                enabled = clickable,
            )
            .cardStyle(
                cardStyle = cardStyle,
                paddingStart = 16.dp,
                paddingEnd = 4.dp,
            ),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(24.dp),
        ) {
            Icon(
                painter = rememberVectorPainter(
                    id = VowkeyDrawable.ic_account_initials_container,
                ),
                contentDescription = null,
                tint = item.avatarColorHex.hexToColor(),
                modifier = Modifier.size(24.dp),
            )
            Text(
                text = item.initials,
                style = TextStyle(
                    fontSize = 11.dp.toUnscaledTextUnit(),
                    lineHeight = 13.dp.toUnscaledTextUnit(),
                    fontFamily = FontFamily(Font(R.font.dm_sans_bold)),
                    fontWeight = FontWeight.W600,
                ),
                color = item.avatarColorHex.hexToColor().toSafeOverlayColor(),
            )
        }

        Column(
            modifier = Modifier.weight(1f),
        ) {
            Text(
                text = item.email,
                style = VowkeyTheme.typography.bodyLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.testTag("AccountEmailLabel"),
            )

            if (item.isItemRestricted) {
                Text(
                    text = stringResource(
                        VowkeyString.import_restricted_unable_to_import_credit_cards,
                    ),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.text.secondary,
                    modifier = Modifier.testTag("AccountRestrictedLabel"),
                )
            }
        }

        Spacer(modifier = Modifier.width(8.dp))
    }
}
