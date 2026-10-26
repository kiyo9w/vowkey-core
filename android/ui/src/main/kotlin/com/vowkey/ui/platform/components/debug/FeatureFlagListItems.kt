package com.vowkey.ui.platform.components.debug

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.resource.VowkeyString

/**
 * Creates a list item for a [FlagKey].
 */
@Composable
fun <T : Any> FlagKey<T>.ListItemContent(
    currentValue: T,
    onValueChange: (key: FlagKey<T>, value: T) -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) = when (val flagKey = this) {
    is FlagKey.DummyInt,
    FlagKey.DummyString,
        -> Unit

    FlagKey.DummyBoolean,
    FlagKey.VowkeyAuthenticationEnabled,
    FlagKey.ForceUpdateKdfSettings,
    FlagKey.NoLogoutOnKdfChange,
    FlagKey.MigrateMyVaultToMyItems,
    FlagKey.CardScanner,
    FlagKey.MobilePremiumUpgrade,
    FlagKey.ManageDevices,
    FlagKey.AttachmentUpdates,
    FlagKey.V2EncryptionJitPassword,
    FlagKey.V2EncryptionKeyConnector,
    FlagKey.V2EncryptionPassword,
    FlagKey.V2EncryptionTde,
    FlagKey.NewItemTypes,
    FlagKey.FillAssistTargetingRules,
    FlagKey.DebugDisableSelfHostPremiumCheck,
    FlagKey.FedRamp,
    FlagKey.Vfo1Foundation,
    FlagKey.SendControls,
    FlagKey.SendControlsExistingSends,
    FlagKey.IdentityAutofill,
    FlagKey.SdkPinUnlock,
    FlagKey.SdkPreLogin,
        -> {
        @Suppress("UNCHECKED_CAST")
        BooleanFlagItem(
            label = flagKey.getDisplayLabel(),
            key = flagKey as FlagKey<Boolean>,
            currentValue = currentValue as Boolean,
            onValueChange = onValueChange as (FlagKey<Boolean>, Boolean) -> Unit,
            cardStyle = cardStyle,
            modifier = modifier,
        )
    }
}

/**
 * The UI layout for a boolean backed flag key.
 */
@Composable
private fun BooleanFlagItem(
    label: String,
    key: FlagKey<Boolean>,
    currentValue: Boolean,
    onValueChange: (key: FlagKey<Boolean>, value: Boolean) -> Unit,
    cardStyle: CardStyle,
    modifier: Modifier = Modifier,
) {
    VowkeySwitch(
        label = label,
        isChecked = currentValue,
        onCheckedChange = { onValueChange(key, it) },
        cardStyle = cardStyle,
        modifier = modifier,
    )
}

@Composable
private fun <T : Any> FlagKey<T>.getDisplayLabel(): String = when (this) {
    FlagKey.DummyBoolean,
    is FlagKey.DummyInt,
    FlagKey.DummyString,
        -> this.keyName

    FlagKey.ForceUpdateKdfSettings -> stringResource(VowkeyString.force_update_kdf_settings)
    FlagKey.NoLogoutOnKdfChange -> stringResource(VowkeyString.avoid_logout_on_kdf_change)
    FlagKey.VowkeyAuthenticationEnabled -> {
        stringResource(VowkeyString.vowkey_authentication_enabled)
    }

    FlagKey.MigrateMyVaultToMyItems -> stringResource(VowkeyString.migrate_my_vault_to_my_items)
    FlagKey.CardScanner -> stringResource(VowkeyString.scan_card)
    FlagKey.MobilePremiumUpgrade -> stringResource(VowkeyString.mobile_premium_upgrade)
    FlagKey.ManageDevices -> stringResource(VowkeyString.manage_devices)
    FlagKey.AttachmentUpdates -> stringResource(VowkeyString.attachment_updates)
    FlagKey.V2EncryptionJitPassword -> stringResource(VowkeyString.v2_encryption_jit_password)
    FlagKey.V2EncryptionKeyConnector -> stringResource(VowkeyString.v2_encryption_key_connector)
    FlagKey.V2EncryptionPassword -> stringResource(VowkeyString.v2_encryption_password)
    FlagKey.V2EncryptionTde -> stringResource(VowkeyString.v2_encryption_tde)
    FlagKey.NewItemTypes -> stringResource(VowkeyString.new_item_types)
    FlagKey.FillAssistTargetingRules -> stringResource(VowkeyString.fill_assist_targeting_rules)
    FlagKey.DebugDisableSelfHostPremiumCheck -> {
        stringResource(VowkeyString.debug_disable_self_host_premium_check)
    }

    FlagKey.FedRamp -> stringResource(VowkeyString.fed_ramp)
    FlagKey.Vfo1Foundation -> stringResource(VowkeyString.vfo1_foundation)
    FlagKey.SendControls -> stringResource(VowkeyString.send_controls)
    FlagKey.SendControlsExistingSends -> {
        stringResource(VowkeyString.send_controls_existing_sends)
    }

    FlagKey.IdentityAutofill -> stringResource(VowkeyString.identity_autofill)
    FlagKey.SdkPinUnlock -> stringResource(VowkeyString.sdk_pin_unlock)
    FlagKey.SdkPreLogin -> stringResource(VowkeyString.sdk_pre_login)
}
