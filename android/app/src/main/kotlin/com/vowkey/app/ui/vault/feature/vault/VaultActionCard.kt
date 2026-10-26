package com.vowkey.app.ui.vault.feature.vault

import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.icon.VowkeyIcon
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import com.vowkey.app.ui.vault.feature.vault.handlers.VaultHandlers

/**
 * The action card for the vault screen.
 */
@Suppress("LongMethod")
@Composable
fun VaultActionCard(
    actionCardState: VaultState.ActionCardState,
    vaultHandlers: VaultHandlers,
    modifier: Modifier = Modifier,
) {
    when (actionCardState) {
        VaultState.ActionCardState.UpgradedToPremium -> {
            VowkeyActionCard(
                cardTitle = stringResource(id = VowkeyString.upgraded_to_premium),
                cardSubtitle = stringResource(
                    id = VowkeyString.you_now_have_access_to_all_advanced_security_features,
                ),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.learn_more.asText(),
                    onClick = { vaultHandlers.actionCardClick(actionCardState) },
                    isExternalLink = true,
                ),
                leadingContent = {
                    Icon(
                        painter = rememberVectorPainter(id = VowkeyDrawable.ic_star),
                        contentDescription = null,
                        tint = VowkeyTheme.colorScheme.icon.secondary,
                    )
                },
                onDismissClick = { vaultHandlers.dismissActionCardClick(actionCardState) },
                modifier = modifier,
            )
        }

        VaultState.ActionCardState.UpgradePremium -> {
            VowkeyActionCard(
                cardTitle = stringResource(
                    id = VowkeyString.unlock_advanced_security_features,
                ),
                cardSubtitle = stringResource(
                    id = VowkeyString
                        .a_premium_plan_gives_you_more_tools_to_stay_secure_and_in_control,
                ),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.learn_more.asText(),
                    onClick = { vaultHandlers.actionCardClick(actionCardState) },
                ),
                onDismissClick = { vaultHandlers.dismissActionCardClick(actionCardState) },
                modifier = modifier,
            )
        }

        VaultState.ActionCardState.PremiumNeedsAttention -> {
            VowkeyActionCard(
                cardTitle = stringResource(id = VowkeyString.your_subscription_needs_attention),
                cardSubtitle = stringResource(id = VowkeyString.check_your_plan_for_details),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.view_plan.asText(),
                    onClick = { vaultHandlers.actionCardClick(actionCardState) },
                ),
                modifier = modifier,
            )
        }

        VaultState.ActionCardState.IntroducingArchive -> {
            VowkeyActionCard(
                cardTitle = stringResource(id = VowkeyString.introducing_archive),
                cardSubtitle = stringResource(
                    id = VowkeyString.keep_items_you_dont_need_right_now_safe_but_out_sight,
                ),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.go_to_archive.asText(),
                    onClick = { vaultHandlers.actionCardClick(actionCardState) },
                ),
                leadingContent = {
                    Icon(
                        painter = rememberVectorPainter(id = VowkeyDrawable.ic_archive),
                        contentDescription = null,
                        tint = VowkeyTheme.colorScheme.icon.secondary,
                    )
                },
                onDismissClick = { vaultHandlers.dismissActionCardClick(actionCardState) },
                modifier = modifier,
            )
        }

        VaultState.ActionCardState.ImportItems -> {
            VowkeyActionCard(
                cardTitle = stringResource(id = VowkeyString.import_saved_logins),
                cardSubtitle = stringResource(id = VowkeyString.use_a_computer_to_import_logins),
                actionButton = VowkeyButtonData(
                    label = VowkeyString.get_started.asText(),
                    onClick = { vaultHandlers.actionCardClick(actionCardState) },
                ),
                onDismissClick = { vaultHandlers.dismissActionCardClick(actionCardState) },
                modifier = modifier,
            )
        }

        is VaultState.ActionCardState.VaultPolicyBanner -> {
            VowkeyActionCard(
                cardTitle = actionCardState.title?.invoke(),
                cardSubtitle = actionCardState.message(),
                actionButton = actionCardState.button?.let {
                    VowkeyButtonData(
                        label = it,
                        onClick = { vaultHandlers.actionCardClick(actionCardState) },
                    )
                },
                onDismissClick = { vaultHandlers.dismissActionCardClick(actionCardState) }
                    .takeIf { actionCardState.button == null },
                leadingContent = {
                    VowkeyIcon(
                        iconData = IconData.Local(iconRes = VowkeyDrawable.ic_info_circle),
                        tint = VowkeyTheme.colorScheme.icon.secondary,
                    )
                },
                modifier = modifier,
            )
        }
    }
}
