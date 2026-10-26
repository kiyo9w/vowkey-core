package com.vowkey.app.ui.vault.feature.vault

import android.content.res.Configuration
import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.card.VowkeyInfoCalloutCard
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * No items view for the [VaultScreen].
 */
@Composable
fun VaultNoItems(
    addItemClickAction: () -> Unit,
    policyDisablesSend: Boolean,
    message: String,
    buttonText: String,
    modifier: Modifier = Modifier,
    @DrawableRes vectorRes: Int? = null,
    headerText: String? = null,
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (policyDisablesSend) {
            VowkeyInfoCalloutCard(
                text = stringResource(id = VowkeyString.send_disabled_warning),
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )
        }

        Spacer(modifier = Modifier.weight(1F))

        vectorRes?.let {
            Image(
                painter = rememberVectorPainter(id = it),
                contentDescription = null,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .size(100.dp),
            )

            Spacer(modifier = Modifier.height(24.dp))
        }
        headerText?.let {
            Text(
                textAlign = TextAlign.Center,
                text = it,
                style = VowkeyTheme.typography.titleMedium,
                color = VowkeyTheme.colorScheme.text.primary,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )
            Spacer(Modifier.height(12.dp))
        }
        Text(
            textAlign = TextAlign.Center,
            text = message,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledButton(
            icon = rememberVectorPainter(VowkeyDrawable.ic_plus_small),
            modifier = Modifier.standardHorizontalMargin(),
            onClick = addItemClickAction,
            label = buttonText,
        )

        Spacer(modifier = Modifier.weight(1F))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Preview(name = "Light theme")
@Preview(name = "Dark theme", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun VaultNoItems_preview() {
    VowkeyTheme {
        Column(
            modifier = Modifier.background(VowkeyTheme.colorScheme.background.primary),
        ) {
            VaultNoItems(
                vectorRes = VowkeyDrawable.ill_vault_items,
                headerText = stringResource(id = VowkeyString.save_and_protect_your_data),
                message = stringResource(
                    VowkeyString.the_vault_protects_more_than_just_passwords,
                ),
                buttonText = stringResource(id = VowkeyString.add_login),
                addItemClickAction = {},
                policyDisablesSend = false,
            )
        }
    }
}

@Preview(name = "Light theme")
@Preview(name = "Dark theme", uiMode = Configuration.UI_MODE_NIGHT_YES)
@Composable
private fun VaultNoItemsPolicyDisabled_preview() {
    VowkeyTheme {
        Column(
            modifier = Modifier.background(VowkeyTheme.colorScheme.background.primary),
        ) {
            VaultNoItems(
                message = stringResource(
                    VowkeyString.the_vault_protects_more_than_just_passwords,
                ),
                buttonText = stringResource(id = VowkeyString.add_login),
                addItemClickAction = {},
                policyDisablesSend = true,
            )
        }
    }
}
