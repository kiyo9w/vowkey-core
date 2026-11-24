@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod")

package com.vowkey.app.ui.vowkey

import android.content.Intent
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.vault.ApiKeyView
import com.vowkey.vault.CardView
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import com.vowkey.vault.EnvironmentMember
import com.vowkey.vault.EnvironmentView
import com.vowkey.vault.LoginUriView
import com.vowkey.app.data.vault.datasource.disk.humanAgentRuleLabel
import com.vowkey.app.data.vault.datasource.disk.itemAgentRule
import com.vowkey.app.data.vault.datasource.disk.newNativeLogin
import kotlin.math.roundToInt
import kotlinx.coroutines.delay

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyItemDetailScreen(
    cipher: CipherView,
    viewModel: VowkeyWorkspaceViewModel,
    onBack: () -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val kind = remember(cipher.type) { VowkeyProfileParser.kindForCipher(cipher) }
    var revealSecret by remember(cipher.id) { mutableStateOf(false) }
    var revealCvv by remember(cipher.id) { mutableStateOf(false) }
    var copiedLabel by remember { mutableStateOf<String?>(null) }
    var nowEpoch by remember { mutableLongStateOf(System.currentTimeMillis() / 1000L) }

    val totpRaw = cipher.login?.totp.orEmpty()
    LaunchedEffect(totpRaw) {
        if (totpRaw.isNotBlank()) {
            while (true) {
                nowEpoch = System.currentTimeMillis() / 1000L
                delay(1000L)
            }
        }
    }
    LaunchedEffect(copiedLabel) {
        if (copiedLabel != null) {
            delay(1500L)
            copiedLabel = null
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyMediumTopAppBar(
                title = kind.singularTitle,
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_back),
                    navigationIconContentDescription = "Back",
                    onNavigationIconClick = onBack,
                ),
                actions = {
                    VowkeyStandardIconButton(
                        vectorIconRes = if (cipher.favorite) {
                            VowkeyDrawable.ic_favorite_full
                        } else {
                            VowkeyDrawable.ic_favorite_empty
                        },
                        contentDescription = if (cipher.favorite) "Unpin" else "Pin",
                        onClick = { viewModel.toggleFavorite(cipher) },
                    )
                    VowkeyStandardIconButton(
                        vectorIconRes = VowkeyDrawable.ic_pencil,
                        contentDescription = "Edit",
                        onClick = { viewModel.startEditCipher(cipher) },
                    )
                },
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .standardHorizontalMargin()
                .padding(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            VowkeyGroupedCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    VowkeyKindTile(kind = kind, size = 46.dp)
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = VowkeyMobileFormat.displayName(cipher.name),
                            style = VowkeyTheme.typography.headlineSmall,
                            color = palette.ink,
                        )
                        Text(
                            text = VowkeyProfileParser.subtitleForCipher(cipher),
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.muted,
                        )
                    }
                }
            }

            if (copiedLabel != null) {
                VowkeyStatusBanner(
                    text = "Copied $copiedLabel",
                    onDismiss = { copiedLabel = null },
                )
            }

            when (cipher.type) {
                CipherType.LOGIN -> {
                    val login = cipher.login
                    val totpInfo = remember(totpRaw, nowEpoch) { VowkeyTotp.compute(totpRaw, nowEpoch) }
                    VowkeySectionLabel("Credentials")
                    VowkeyGroupedCard {
                        val user = login?.username.orEmpty()
                        if (user.isNotBlank()) {
                            CopyableDetailRow(
                                label = "Username",
                                value = user,
                                mono = false,
                                onCopy = {
                                    context.copyPlainText("Username", user)
                                    copiedLabel = "username"
                                },
                            )
                        }
                        val pwd = login?.password.orEmpty()
                        if (pwd.isNotBlank()) {
                            if (user.isNotBlank()) HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            SecretDetailRow(
                                label = "Password",
                                rawValue = pwd,
                                maskedValue = "••••••••••••",
                                revealed = revealSecret,
                                onToggleReveal = { revealSecret = !revealSecret },
                                onCopy = {
                                    context.copyPlainText("Password", pwd)
                                    copiedLabel = "password"
                                },
                            )
                        }
                        if (totpInfo != null) {
                            HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            CopyableDetailRow(
                                label = "Verification code (${totpInfo.second}s)",
                                value = totpInfo.first,
                                mono = true,
                                onCopy = {
                                    val digitsOnly = totpInfo.first.replace(" ", "")
                                    context.copyPlainText("Verification code", digitsOnly)
                                    copiedLabel = "verification code"
                                },
                            )
                        }
                        val uri = login?.uris?.firstOrNull()?.uri.orEmpty()
                        if (uri.isNotBlank()) {
                            HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text("Website", style = VowkeyTheme.typography.labelMedium, color = palette.muted)
                                    Text(uri, style = VowkeyTheme.typography.bodyLarge, color = palette.ink)
                                }
                                VowkeyTextButton(
                                    label = "Open",
                                    onClick = {
                                        val normalized = if (uri.startsWith("http://") || uri.startsWith("https://")) {
                                            uri
                                        } else {
                                            "https://$uri"
                                        }
                                        runCatching {
                                            context.startActivity(Intent(Intent.ACTION_VIEW, normalized.toUri()))
                                        }
                                    },
                                )
                            }
                        }
                    }
                }

                CipherType.CARD -> {
                    val card = cipher.card
                    VowkeySectionLabel("Payment card")
                    VowkeyGroupedCard {
                        val holder = card?.cardholderName.orEmpty()
                        if (holder.isNotBlank()) {
                            CopyableDetailRow(
                                label = "Cardholder name",
                                value = holder,
                                mono = false,
                                onCopy = {
                                    context.copyPlainText("Cardholder name", holder)
                                    copiedLabel = "cardholder name"
                                },
                            )
                        }
                        val num = card?.number.orEmpty()
                        if (num.isNotBlank()) {
                            if (holder.isNotBlank()) HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            val last4 = num.filter(Char::isDigit).takeLast(4)
                            SecretDetailRow(
                                label = "Card number",
                                rawValue = num,
                                maskedValue = "•••• •••• •••• $last4",
                                revealed = revealSecret,
                                onToggleReveal = { revealSecret = !revealSecret },
                                onCopy = {
                                    context.copyPlainText("Card number", num)
                                    copiedLabel = "card number"
                                },
                            )
                        }
                        val exp = listOfNotNull(
                            card?.expMonth?.takeIf { it.isNotBlank() },
                            card?.expYear?.takeIf { it.isNotBlank() },
                        ).joinToString(" / ")
                        if (exp.isNotBlank()) {
                            HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            CopyableDetailRow(
                                label = "Expiration",
                                value = exp,
                                mono = true,
                                onCopy = {
                                    context.copyPlainText("Expiration", exp)
                                    copiedLabel = "expiration"
                                },
                            )
                        }
                        val cvv = card?.code.orEmpty()
                        if (cvv.isNotBlank()) {
                            HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            SecretDetailRow(
                                label = "Security code",
                                rawValue = cvv,
                                maskedValue = "•••",
                                revealed = revealCvv,
                                onToggleReveal = { revealCvv = !revealCvv },
                                onCopy = {
                                    context.copyPlainText("Security code", cvv)
                                    copiedLabel = "security code"
                                },
                            )
                        }
                    }

                    val currentCardRule = cipher.itemAgentRule("ask")
                    VowkeySectionLabel("AI access")
                    VowkeyGroupedCard {
                        Column(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Text(
                                text = "Choose whether Vowkey and paired AI agents can fill this card.",
                                style = VowkeyTheme.typography.bodySmall,
                                color = palette.muted,
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                listOf("fill", "ask", "never").forEach { code ->
                                    val selected = currentCardRule == code
                                    Surface(
                                        shape = RoundedCornerShape(8.dp),
                                        color = if (selected) palette.blueSoft else palette.surfaceSubtle,
                                        border = BorderStroke(
                                            1.dp,
                                            if (selected) palette.blueSoftBorder else palette.line,
                                        ),
                                        modifier = Modifier.clickable {
                                            viewModel.setItemAgentRule(cipher, code)
                                        },
                                    ) {
                                        Text(
                                            text = humanAgentRuleLabel(code),
                                            style = VowkeyTheme.typography.labelSmall,
                                            color = if (selected) palette.blueInk else palette.ink,
                                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                CipherType.API_KEY -> {
                    val apiKey = cipher.apiKey
                    val handle = "@vk:${cipher.id ?: "item"}/key.value"
                    VowkeySectionLabel("API key")
                    VowkeyGroupedCard {
                        CopyableDetailRow(
                            label = "Vowkey handle (safe for .env & AI agents)",
                            value = handle,
                            mono = true,
                            onCopy = {
                                context.copyPlainText("Vowkey handle", handle)
                                copiedLabel = "handle"
                            },
                        )
                        val keyVal = apiKey?.value.orEmpty()
                        if (keyVal.isNotBlank()) {
                            HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            SecretDetailRow(
                                label = "Secret key",
                                rawValue = keyVal,
                                maskedValue = "•••• ${keyVal.takeLast(4)}",
                                revealed = revealSecret,
                                onToggleReveal = { revealSecret = !revealSecret },
                                onCopy = {
                                    context.copyPlainText("API key", keyVal)
                                    copiedLabel = "API key"
                                },
                            )
                        }
                        HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                        CopyableDetailRow(
                            label = "Authorization format",
                            value = apiKey?.sendStyle ?: "bearer",
                            mono = false,
                            onCopy = {},
                        )
                        val hosts = apiKey?.allowedHosts.orEmpty()
                        if (hosts.isNotEmpty()) {
                            HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                            CopyableDetailRow(
                                label = "Allowed hosts",
                                value = hosts.joinToString(", "),
                                mono = true,
                                onCopy = {
                                    context.copyPlainText("Allowed hosts", hosts.joinToString(", "))
                                    copiedLabel = "allowed hosts"
                                },
                            )
                        }
                    }
                }

                CipherType.ENVIRONMENT -> {
                    val members = cipher.environment?.members.orEmpty()
                    val envBlock = members.joinToString("\n") { "${it.name}=@vk:${it.itemId}/key.value" }
                    VowkeySectionLabel("Environment variables")
                    VowkeyGroupedCard {
                        if (members.isEmpty()) {
                            Text(
                                text = "No variables bound yet.",
                                style = VowkeyTheme.typography.bodyMedium,
                                color = palette.muted,
                                modifier = Modifier.padding(16.dp),
                            )
                        } else {
                            members.forEachIndexed { idx, m ->
                                if (idx > 0) HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                                val line = "${m.name}=@vk:${m.itemId}/key.value"
                                CopyableDetailRow(
                                    label = m.name,
                                    value = "@vk:${m.itemId}/key.value",
                                    mono = true,
                                    onCopy = {
                                        context.copyPlainText(m.name, line)
                                        copiedLabel = m.name
                                    },
                                )
                            }
                        }
                    }
                    if (envBlock.isNotBlank()) {
                        VowkeyOutlinedButton(
                            label = "Copy .env block",
                            onClick = {
                                context.copyPlainText(".env", envBlock)
                                copiedLabel = ".env block"
                            },
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                }

                else -> Unit
            }

            val notes = cipher.notes.orEmpty()
            if (notes.isNotBlank()) {
                VowkeySectionLabel("Notes")
                VowkeyGroupedCard {
                    CopyableDetailRow(
                        label = "Note",
                        value = notes,
                        mono = false,
                        onCopy = {
                            context.copyPlainText("Note", notes)
                            copiedLabel = "note"
                        },
                    )
                }
            }

            VowkeyTextButton(
                label = "Move to Recently deleted",
                onClick = { viewModel.softDelete(cipher) },
                contentColor = palette.red,
                modifier = Modifier.align(Alignment.CenterHorizontally),
            )
            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun CopyableDetailRow(
    label: String,
    value: String,
    mono: Boolean,
    onCopy: () -> Unit,
) {
    val palette = currentVowkeyPalette()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onCopy)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = VowkeyTheme.typography.labelMedium, color = palette.muted)
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = value,
                style = if (mono) VowkeyTheme.typography.sensitiveInfoSmall else VowkeyTheme.typography.bodyLargeEmphasis,
                color = palette.ink,
            )
        }
        IconButton(onClick = onCopy, modifier = Modifier.size(34.dp)) {
            Icon(
                painter = painterResource(VowkeyDrawable.ic_copy),
                contentDescription = "Copy",
                tint = palette.iconPrimary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@Composable
private fun SecretDetailRow(
    label: String,
    rawValue: String,
    maskedValue: String,
    revealed: Boolean,
    onToggleReveal: () -> Unit,
    onCopy: () -> Unit,
) {
    val palette = currentVowkeyPalette()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onCopy)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(text = label, style = VowkeyTheme.typography.labelMedium, color = palette.muted)
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = if (revealed) rawValue else maskedValue,
                style = VowkeyTheme.typography.sensitiveInfoSmall,
                color = palette.ink,
            )
        }
        IconButton(onClick = onToggleReveal, modifier = Modifier.size(34.dp)) {
            Icon(
                painter = painterResource(if (revealed) VowkeyDrawable.ic_eye_slash else VowkeyDrawable.ic_eye),
                contentDescription = if (revealed) "Hide" else "Reveal",
                tint = palette.iconPrimary,
                modifier = Modifier.size(18.dp),
            )
        }
        IconButton(onClick = onCopy, modifier = Modifier.size(34.dp)) {
            Icon(
                painter = painterResource(VowkeyDrawable.ic_copy),
                contentDescription = "Copy",
                tint = palette.iconPrimary,
                modifier = Modifier.size(18.dp),
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyItemEditorSheet(
    draft: CipherView,
    availableApiKeys: List<CipherView>,
    onSave: (CipherView) -> Unit,
    onDismiss: () -> Unit,
) {
    val palette = currentVowkeyPalette()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    val isNew = draft.id == null
    val kind = VowkeyProfileParser.kindForCipher(draft)

    var name by remember(draft) { mutableStateOf(draft.name) }
    var notes by remember(draft) { mutableStateOf(draft.notes.orEmpty()) }

    // Login state
    var username by remember(draft) { mutableStateOf(draft.login?.username.orEmpty()) }
    var password by remember(draft) { mutableStateOf(draft.login?.password.orEmpty()) }
    var totp by remember(draft) { mutableStateOf(draft.login?.totp.orEmpty()) }
    var uri by remember(draft) { mutableStateOf(draft.login?.uris?.firstOrNull()?.uri.orEmpty()) }
    var showInlineGenerator by remember { mutableStateOf(false) }

    // Card state
    var cardholder by remember(draft) { mutableStateOf(draft.card?.cardholderName.orEmpty()) }
    var cardNumber by remember(draft) { mutableStateOf(draft.card?.number.orEmpty()) }
    var expMonth by remember(draft) { mutableStateOf(draft.card?.expMonth.orEmpty()) }
    var expYear by remember(draft) { mutableStateOf(draft.card?.expYear.orEmpty()) }
    var securityCode by remember(draft) { mutableStateOf(draft.card?.code.orEmpty()) }

    // API key state
    var keySecret by remember(draft) { mutableStateOf(draft.apiKey?.value.orEmpty()) }
    var sendStyle by remember(draft) { mutableStateOf(draft.apiKey?.sendStyle ?: "bearer") }
    var headerName by remember(draft) { mutableStateOf(draft.apiKey?.headerName.orEmpty()) }
    var basicUser by remember(draft) { mutableStateOf(draft.apiKey?.basicUsername.orEmpty()) }
    var allowedHosts by remember(draft) { mutableStateOf(draft.apiKey?.allowedHosts.orEmpty().joinToString(", ")) }

    // Environment state
    var envText by remember(draft) {
        mutableStateOf(
            draft.environment?.members.orEmpty().joinToString("\n") { "${it.name}=@vk:${it.itemId}/key.value" },
        )
    }
    var validationError by remember { mutableStateOf<String?>(null) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = VowkeyTheme.shapes.bottomSheet,
        containerColor = palette.canvas,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = if (isNew) "New ${kind.singularTitle.lowercase()}" else "Edit ${kind.singularTitle.lowercase()}",
                    style = VowkeyTheme.typography.headlineSmall,
                    color = palette.ink,
                    modifier = Modifier.weight(1f),
                )
                VowkeyTextButton(label = "Cancel", onClick = onDismiss)
            }

            if (validationError != null) {
                Text(
                    text = validationError!!,
                    style = VowkeyTheme.typography.bodySmall,
                    color = palette.red,
                )
            }

            VowkeyTextField(
                label = "Name",
                value = name,
                onValueChange = { name = it },
                cardStyle = CardStyle.Full,
            )

            when (draft.type) {
                CipherType.LOGIN -> {
                    VowkeyTextField(
                        label = "Username or email",
                        value = username,
                        onValueChange = { username = it },
                        cardStyle = CardStyle.Full,
                    )
                    VowkeyTextField(
                        label = "Password",
                        value = password,
                        onValueChange = { password = it },
                        cardStyle = CardStyle.Full,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        VowkeyOutlinedButton(
                            label = "Generate strong password",
                            onClick = { password = VowkeyCryptoGenerator.password() },
                            modifier = Modifier.weight(1f),
                        )
                        VowkeyTextButton(
                            label = "Options",
                            onClick = { showInlineGenerator = true },
                        )
                    }
                    VowkeyTextField(
                        label = "Website or app URI",
                        value = uri,
                        onValueChange = { uri = it },
                        cardStyle = CardStyle.Full,
                    )
                    VowkeyTextField(
                        label = "Authenticator key (TOTP, optional)",
                        value = totp,
                        onValueChange = { totp = it },
                        cardStyle = CardStyle.Full,
                    )
                }

                CipherType.CARD -> {
                    VowkeyTextField(
                        label = "Cardholder name",
                        value = cardholder,
                        onValueChange = { cardholder = it },
                        cardStyle = CardStyle.Full,
                    )
                    VowkeyTextField(
                        label = "Card number",
                        value = cardNumber,
                        onValueChange = { cardNumber = it },
                        cardStyle = CardStyle.Full,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        VowkeyTextField(
                            label = "Exp month (MM)",
                            value = expMonth,
                            onValueChange = { expMonth = it },
                            cardStyle = CardStyle.Full,
                            modifier = Modifier.weight(1f),
                        )
                        VowkeyTextField(
                            label = "Exp year (YYYY)",
                            value = expYear,
                            onValueChange = { expYear = it },
                            cardStyle = CardStyle.Full,
                            modifier = Modifier.weight(1f),
                        )
                    }
                    VowkeyTextField(
                        label = "Security code (CVV)",
                        value = securityCode,
                        onValueChange = { securityCode = it },
                        cardStyle = CardStyle.Full,
                    )
                }

                CipherType.API_KEY -> {
                    VowkeyTextField(
                        label = "Secret key value",
                        value = keySecret,
                        onValueChange = { keySecret = it },
                        cardStyle = CardStyle.Full,
                    )
                    VowkeySectionLabel("Authorization format")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("bearer", "header", "basic").forEach { style ->
                            val selected = sendStyle == style
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if (selected) palette.blueSoft else palette.surface,
                                border = BorderStroke(1.dp, if (selected) palette.blueSoftBorder else palette.line),
                                modifier = Modifier.clickable { sendStyle = style },
                            ) {
                                Text(
                                    text = style,
                                    style = VowkeyTheme.typography.labelMedium,
                                    color = if (selected) palette.blueInk else palette.ink,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                )
                            }
                        }
                    }
                    if (sendStyle == "header") {
                        VowkeyTextField(
                            label = "Header name (e.g. X-API-Key)",
                            value = headerName,
                            onValueChange = { headerName = it },
                            cardStyle = CardStyle.Full,
                        )
                    } else if (sendStyle == "basic") {
                        VowkeyTextField(
                            label = "Basic auth username",
                            value = basicUser,
                            onValueChange = { basicUser = it },
                            cardStyle = CardStyle.Full,
                        )
                    }
                    VowkeyTextField(
                        label = "Allowed hosts (comma-separated, e.g. api.openai.com)",
                        value = allowedHosts,
                        onValueChange = { allowedHosts = it },
                        cardStyle = CardStyle.Full,
                    )
                }

                CipherType.ENVIRONMENT -> {
                    VowkeyTextField(
                        label = "Variables (NAME=@vk:<id>/key.value, one per line)",
                        value = envText,
                        onValueChange = { envText = it },
                        cardStyle = CardStyle.Full,
                        singleLine = false,
                    )
                    if (availableApiKeys.isNotEmpty()) {
                        VowkeySectionLabel("Insert saved API key")
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                        ) {
                            availableApiKeys.forEach { k ->
                                val keyId = k.id ?: return@forEach
                                val envVarName = k.name.uppercase()
                                    .replace(Regex("[^A-Z0-9]+"), "_")
                                    .trim('_')
                                    .ifBlank { "API_KEY" }
                                Surface(
                                    shape = RoundedCornerShape(8.dp),
                                    color = palette.surface,
                                    border = BorderStroke(1.dp, palette.line),
                                    modifier = Modifier.clickable {
                                        val entry = "$envVarName=@vk:$keyId/key.value"
                                        envText = if (envText.isBlank()) entry else "$envText\n$entry"
                                    },
                                ) {
                                    Text(
                                        text = "+ ${k.name}",
                                        style = VowkeyTheme.typography.labelMedium,
                                        color = palette.blue,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                                    )
                                }
                            }
                        }
                    }
                }

                else -> Unit
            }

            if (draft.type != CipherType.IDENTITY) {
                VowkeyTextField(
                    label = "Notes",
                    value = notes,
                    onValueChange = { notes = it },
                    cardStyle = CardStyle.Full,
                    singleLine = false,
                )
            }

            VowkeyFilledButton(
                label = "Save",
                onClick = {
                    validationError = null
                    val finalName = name.trim().ifBlank { kind.singularTitle }
                    val updated = when (draft.type) {
                        CipherType.LOGIN -> draft.copy(
                            name = finalName,
                            notes = notes.takeIf { it.isNotBlank() },
                            login = (draft.login ?: newNativeLogin()).copy(
                                username = username.takeIf { it.isNotBlank() },
                                password = password.takeIf { it.isNotBlank() },
                                totp = totp.takeIf { it.isNotBlank() },
                                uris = uri.trim().takeIf { it.isNotBlank() }?.let { listOf(LoginUriView(it, null, null)) }.orEmpty(),
                            ),
                        )
                        CipherType.CARD -> draft.copy(
                            name = finalName,
                            notes = notes.takeIf { it.isNotBlank() },
                            card = CardView(
                                cardholderName = cardholder.takeIf { it.isNotBlank() },
                                expMonth = expMonth.takeIf { it.isNotBlank() },
                                expYear = expYear.takeIf { it.isNotBlank() },
                                code = securityCode.takeIf { it.isNotBlank() },
                                brand = draft.card?.brand,
                                number = cardNumber.takeIf { it.isNotBlank() },
                            ),
                        )
                        CipherType.API_KEY -> draft.copy(
                            name = finalName,
                            notes = notes.takeIf { it.isNotBlank() },
                            apiKey = ApiKeyView(
                                value = keySecret,
                                sendStyle = sendStyle,
                                headerName = headerName.takeIf { sendStyle == "header" && it.isNotBlank() },
                                basicUsername = basicUser.takeIf { sendStyle == "basic" && it.isNotBlank() },
                                allowedHosts = allowedHosts.split(',').map { it.trim() }.filter { it.isNotEmpty() },
                            ),
                        )
                        CipherType.ENVIRONMENT -> {
                            val members = mutableListOf<EnvironmentMember>()
                            for (line in envText.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }) {
                                val parts = line.split('=', limit = 2)
                                if (parts.size != 2 || !parts[0].matches(Regex("[A-Za-z_][A-Za-z0-9_]*"))) {
                                    validationError = "Write each line as NAME=@vk:<id>/key.value"
                                    return@VowkeyFilledButton
                                }
                                val itemId = Regex("@vk:([^/\\s]+)/key\\.value")
                                    .matchEntire(parts[1])?.groupValues?.get(1)
                                if (itemId == null) {
                                    validationError = "Link each variable to a saved @vk:<id>/key.value handle."
                                    return@VowkeyFilledButton
                                }
                                members.add(EnvironmentMember(name = parts[0], itemId = itemId))
                            }
                            draft.copy(
                                name = finalName,
                                notes = notes.takeIf { it.isNotBlank() },
                                environment = EnvironmentView(members = members),
                            )
                        }
                        CipherType.IDENTITY -> draft.copy(name = finalName)
                        else -> draft.copy(
                            name = finalName,
                            notes = notes,
                        )
                    }
                    onSave(updated)
                },
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }

    if (showInlineGenerator) {
        VowkeyGeneratorSheet(
            onUseGenerated = { generated ->
                password = generated
                showInlineGenerator = false
            },
            onDismiss = { showInlineGenerator = false },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyGeneratorSheet(
    onUseGenerated: ((String) -> Unit)? = null,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var mode by remember { mutableStateOf("password") }
    var length by remember { mutableFloatStateOf(20f) }
    var wordCount by remember { mutableFloatStateOf(4f) }
    var useUpper by remember { mutableStateOf(true) }
    var useDigits by remember { mutableStateOf(true) }
    var useSymbols by remember { mutableStateOf(true) }
    var nonce by remember { mutableLongStateOf(0L) }
    var copied by remember { mutableStateOf(false) }

    val value = remember(mode, length.roundToInt(), wordCount.roundToInt(), useUpper, useDigits, useSymbols, nonce) {
        when (mode) {
            "passphrase" -> VowkeyCryptoGenerator.passphrase(wordCount = wordCount.roundToInt())
            "pin" -> VowkeyCryptoGenerator.pin(length = length.roundToInt().coerceIn(4, 12))
            else -> VowkeyCryptoGenerator.password(
                length = length.roundToInt(),
                uppercase = useUpper,
                digits = useDigits,
                symbols = useSymbols,
            )
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = VowkeyTheme.shapes.bottomSheet,
        containerColor = palette.canvas,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Generator",
                    style = VowkeyTheme.typography.headlineSmall,
                    color = palette.ink,
                    modifier = Modifier.weight(1f),
                )
                VowkeyTextButton(label = "Done", onClick = onDismiss)
            }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("password" to "Password", "passphrase" to "Passphrase", "pin" to "PIN").forEach { (id, title) ->
                    val selected = mode == id
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = if (selected) palette.blueSoft else palette.surface,
                        border = BorderStroke(1.dp, if (selected) palette.blueSoftBorder else palette.line),
                        modifier = Modifier.clickable {
                            mode = id
                            if (id == "pin") length = 6f else if (id == "password" && length < 12f) length = 20f
                            copied = false
                        },
                    ) {
                        Text(
                            text = title,
                            style = VowkeyTheme.typography.labelMedium,
                            color = if (selected) palette.blueInk else palette.ink,
                            modifier = Modifier.padding(horizontal = 14.dp, vertical = 7.dp),
                        )
                    }
                }
            }

            VowkeyGroupedCard {
                Text(
                    text = value,
                    style = VowkeyTheme.typography.sensitiveInfoMedium,
                    color = palette.ink,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(18.dp),
                )
            }

            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                VowkeyOutlinedButton(
                    label = "Regenerate",
                    onClick = {
                        nonce++
                        copied = false
                    },
                    modifier = Modifier.weight(1f),
                )
                VowkeyFilledButton(
                    label = when {
                        onUseGenerated != null -> "Use value"
                        copied -> "Copied"
                        else -> "Copy"
                    },
                    onClick = {
                        if (onUseGenerated != null) {
                            onUseGenerated(value)
                        } else {
                            context.copyPlainText("Generated secret", value)
                            copied = true
                        }
                    },
                    modifier = Modifier.weight(1f),
                )
            }

            when (mode) {
                "password" -> {
                    Column {
                        Text(
                            text = "Length: ${length.roundToInt()}",
                            style = VowkeyTheme.typography.labelMedium,
                            color = palette.ink,
                        )
                        Slider(
                            value = length,
                            onValueChange = { length = it },
                            valueRange = 8f..40f,
                        )
                    }
                    VowkeySwitch(
                        label = "Uppercase (A–Z)",
                        isChecked = useUpper,
                        onCheckedChange = { useUpper = it },
                        cardStyle = CardStyle.Top(dividerPadding = 16.dp),
                    )
                    VowkeySwitch(
                        label = "Numbers (0–9)",
                        isChecked = useDigits,
                        onCheckedChange = { useDigits = it },
                        cardStyle = CardStyle.Middle(dividerPadding = 16.dp),
                    )
                    VowkeySwitch(
                        label = "Symbols (!@#…)",
                        isChecked = useSymbols,
                        onCheckedChange = { useSymbols = it },
                        cardStyle = CardStyle.Bottom,
                    )
                }
                "passphrase" -> {
                    Text(
                        text = "Words: ${wordCount.roundToInt()}",
                        style = VowkeyTheme.typography.labelMedium,
                        color = palette.ink,
                    )
                    Slider(
                        value = wordCount,
                        onValueChange = { wordCount = it },
                        valueRange = 3f..8f,
                    )
                }
                "pin" -> {
                    Text(
                        text = "Digits: ${length.roundToInt().coerceIn(4, 12)}",
                        style = VowkeyTheme.typography.labelMedium,
                        color = palette.ink,
                    )
                    Slider(
                        value = length.coerceIn(4f, 12f),
                        onValueChange = { length = it },
                        valueRange = 4f..12f,
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyRecentlyDeletedSheet(
    deletedItems: List<CipherView>,
    viewModel: VowkeyWorkspaceViewModel,
    onDismiss: () -> Unit,
) {
    val palette = currentVowkeyPalette()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
        shape = VowkeyTheme.shapes.bottomSheet,
        containerColor = palette.canvas,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
                .padding(bottom = 28.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = "Recently deleted",
                    style = VowkeyTheme.typography.headlineSmall,
                    color = palette.ink,
                    modifier = Modifier.weight(1f),
                )
                VowkeyTextButton(label = "Done", onClick = onDismiss)
            }

            if (deletedItems.isEmpty()) {
                VowkeyGroupedCard {
                    Text(
                        text = "No recently deleted items.",
                        style = VowkeyTheme.typography.bodyMedium,
                        color = palette.muted,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            } else {
                VowkeyGroupedCard {
                    deletedItems.forEachIndexed { idx, item ->
                        if (idx > 0) HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 16.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(
                                    text = VowkeyMobileFormat.displayName(item.name),
                                    style = VowkeyTheme.typography.bodyLargeEmphasis,
                                    color = palette.ink,
                                )
                                Text(
                                    text = VowkeyProfileParser.kindForCipher(item).singularTitle,
                                    style = VowkeyTheme.typography.bodySmall,
                                    color = palette.muted,
                                )
                            }
                            VowkeyTextButton(
                                label = "Restore",
                                onClick = { viewModel.restoreItem(item) },
                            )
                            VowkeyTextButton(
                                label = "Delete",
                                onClick = { viewModel.hardDelete(item) },
                            )
                        }
                    }
                }
                VowkeyOutlinedButton(
                    label = "Empty Recently deleted",
                    onClick = { viewModel.emptyTrash() },
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}
