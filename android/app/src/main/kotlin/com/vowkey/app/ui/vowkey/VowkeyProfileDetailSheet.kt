@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod")

package com.vowkey.app.ui.vowkey

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vowkey.app.data.vault.datasource.disk.humanAgentRuleLabel
import com.vowkey.app.data.vault.datasource.disk.humanVariantBadge
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
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.vault.CipherView
import kotlinx.coroutines.delay

internal fun Context.copyPlainText(label: String, text: String) {
    val cm = getSystemService(Context.CLIPBOARD_SERVICE) as? ClipboardManager ?: return
    cm.setPrimaryClip(ClipData.newPlainText(label, text))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyProfileDetailScreen(
    cipher: CipherView,
    viewModel: VowkeyWorkspaceViewModel,
    onBack: () -> Unit,
    onOpenDocument: (VowkeyDocumentItem) -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val details = remember(cipher) { VowkeyProfileParser.parseDetails(cipher) }
    val documents = remember(cipher) { VowkeyProfileParser.extractDocuments(cipher) }
    val isSample = remember(cipher) { VowkeySampleWalkthrough.isSampleCipher(cipher) }
    val cleanName = remember(cipher.name) { VowkeyMobileFormat.displayName(cipher.name) }

    val concealedIds = remember(cipher.id) { mutableStateMapOf<String, Boolean>() }
    var copiedDetailId by remember { mutableStateOf<String?>(null) }
    var showRenameDialog by remember { mutableStateOf(false) }
    var editingDetail by remember { mutableStateOf<VowkeyParsedDetail?>(null) }
    var addingNewDetail by remember { mutableStateOf(false) }
    var showInDocTarget by remember { mutableStateOf<VowkeyParsedDetail?>(null) }
    var largeTypeDetail by remember { mutableStateOf<VowkeyParsedDetail?>(null) }

    LaunchedEffect(copiedDetailId) {
        if (copiedDetailId != null) {
            delay(1600)
            copiedDetailId = null
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyMediumTopAppBar(
                title = "Profile",
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
                        contentDescription = "Rename profile",
                        onClick = { showRenameDialog = true },
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
            // Hero Header Card
            VowkeyGroupedCard {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(14.dp),
                    ) {
                        VowkeyMonogramTile(
                            name = cleanName,
                            size = 52.dp,
                            highlighted = true,
                        )
                        Column(modifier = Modifier.weight(1f)) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                Text(
                                    text = cleanName,
                                    style = VowkeyTheme.typography.headlineSmall,
                                    color = palette.ink,
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false),
                                )
                                if (isSample) {
                                    VowkeySampleTag()
                                }
                            }
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = VowkeyProfileParser.subtitleForCipher(cipher),
                                style = VowkeyTheme.typography.bodyMedium,
                                color = palette.muted,
                            )
                        }
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        VowkeyFilledButton(
                            label = "Fill form",
                            onClick = { viewModel.openFillForm(cipher.id) },
                            modifier = Modifier.weight(1f),
                        )
                        VowkeyOutlinedButton(
                            label = "Add document",
                            onClick = { viewModel.openAddDocument(cipher.id) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                }
            }

            // Grouped Details
            val groupOrder = listOf("Personal", "Identification", "Contact & address", "Work & banking", "Details")
            val grouped = details.groupBy { it.group }
            val nonEmptyGroups = groupOrder.filter { !grouped[it].isNullOrEmpty() }
            if (details.isEmpty()) {
                VowkeyGroupedCard {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp),
                    ) {
                        Text(
                            text = "No details yet",
                            style = VowkeyTheme.typography.titleSmall,
                            color = palette.ink,
                        )
                        Text(
                            text = "Add a document to extract details with source highlights, or add a detail manually.",
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.muted,
                        )
                        VowkeyOutlinedButton(
                            label = "Add detail",
                            onClick = { addingNewDetail = true },
                        )
                    }
                }
            } else {
                nonEmptyGroups.forEachIndexed { groupIdx, groupName ->
                    val rows = grouped[groupName].orEmpty()
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                        ) {
                            VowkeySectionLabel(groupName)
                            if (groupIdx == 0) {
                                Text(
                                    text = "Add detail",
                                    style = VowkeyTheme.typography.labelMedium,
                                    color = palette.blue,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(6.dp))
                                        .clickable { addingNewDetail = true }
                                        .padding(horizontal = 6.dp, vertical = 2.dp),
                                )
                            }
                        }
                        VowkeyGroupedCard {
                            rows.forEachIndexed { idx, detail ->
                                if (idx > 0) {
                                    HorizontalDivider(
                                        color = palette.line,
                                        modifier = Modifier.padding(start = 16.dp),
                                    )
                                }
                                val isConcealed = concealedIds[detail.id] == true
                                val isRevealed = !detail.isSensitive || !isConcealed
                                val shownText = if (isRevealed) {
                                    detail.currentValue
                                } else {
                                    detail.maskedValue
                                }
                                val matchedDoc = detail.selectedVariant?.let { v ->
                                    if (v.locator == null) {
                                        null
                                    } else if (v.sourceId != null) {
                                        documents.firstOrNull { it.sourceId == v.sourceId }
                                    } else {
                                        documents.firstOrNull()
                                    }
                                }
                                val hasLocator = matchedDoc != null
                                Column(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable {
                                            context.copyPlainText(detail.label, detail.currentValue)
                                            copiedDetailId = detail.id
                                        }
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                ) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Row(
                                                verticalAlignment = Alignment.CenterVertically,
                                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            ) {
                                                Text(
                                                    text = detail.label,
                                                    style = VowkeyTheme.typography.labelMedium,
                                                    color = palette.muted,
                                                )
                                                if (detail.agentRule == "never") {
                                                    Surface(
                                                        shape = RoundedCornerShape(6.dp),
                                                        color = palette.redSoft,
                                                        border = BorderStroke(1.dp, palette.redBorder),
                                                    ) {
                                                        Text(
                                                            text = "Don't fill",
                                                            style = VowkeyTheme.typography.labelSmall,
                                                            color = palette.red,
                                                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                                                        )
                                                    }
                                                }
                                                if (copiedDetailId == detail.id) {
                                                    Text(
                                                        text = "Copied",
                                                        style = VowkeyTheme.typography.labelSmall,
                                                        color = palette.green,
                                                    )
                                                }
                                            }
                                            Spacer(modifier = Modifier.height(3.dp))
                                            Text(
                                                text = shownText,
                                                style = if (detail.isSensitive) {
                                                    VowkeyTheme.typography.sensitiveInfoSmall
                                                } else {
                                                    VowkeyTheme.typography.bodyLargeEmphasis
                                                },
                                                color = palette.ink,
                                            )
                                        }

                                        if (detail.isSensitive) {
                                            IconButton(
                                                onClick = { concealedIds[detail.id] = !isConcealed },
                                                modifier = Modifier.size(32.dp),
                                            ) {
                                                Icon(
                                                    painter = painterResource(
                                                        if (isRevealed) VowkeyDrawable.ic_eye_slash else VowkeyDrawable.ic_eye,
                                                    ),
                                                    contentDescription = if (isRevealed) "Hide" else "Reveal",
                                                    tint = palette.iconSecondary,
                                                    modifier = Modifier.size(18.dp),
                                                )
                                            }
                                        }

                                        if (hasLocator) {
                                            Surface(
                                                shape = RoundedCornerShape(8.dp),
                                                color = palette.blueSoft,
                                                border = BorderStroke(1.dp, palette.blueSoftBorder),
                                                modifier = Modifier
                                                    .padding(horizontal = 2.dp)
                                                    .size(30.dp)
                                                    .clip(RoundedCornerShape(8.dp))
                                                    .clickable { showInDocTarget = detail },
                                            ) {
                                                Box(contentAlignment = Alignment.Center) {
                                                    Icon(
                                                        painter = painterResource(VowkeyDrawable.ic_search),
                                                        contentDescription = "Show in document",
                                                        tint = palette.blueInk,
                                                        modifier = Modifier.size(16.dp),
                                                    )
                                                }
                                            }
                                        }

                                        var rowMenuOpen by remember { mutableStateOf(false) }
                                        Box {
                                            IconButton(
                                                onClick = { rowMenuOpen = true },
                                                modifier = Modifier.size(32.dp),
                                            ) {
                                                Icon(
                                                    painter = painterResource(VowkeyDrawable.ic_ellipsis_horizontal),
                                                    contentDescription = "More options",
                                                    tint = palette.muted,
                                                    modifier = Modifier.size(18.dp),
                                                )
                                            }
                                            DropdownMenu(
                                                expanded = rowMenuOpen,
                                                onDismissRequest = { rowMenuOpen = false },
                                            ) {
                                                DropdownMenuItem(
                                                    text = { Text("Edit") },
                                                    onClick = {
                                                        rowMenuOpen = false
                                                        editingDetail = detail
                                                    },
                                                )
                                                DropdownMenuItem(
                                                    text = { Text("Large type") },
                                                    onClick = {
                                                        rowMenuOpen = false
                                                        largeTypeDetail = detail
                                                    },
                                                )
                                                HorizontalDivider(color = palette.line)
                                                listOf(
                                                    "fill" to "Fill without asking",
                                                    "ask" to "Ask first",
                                                    "never" to "Don't fill",
                                                ).forEach { (code, text) ->
                                                    val active = detail.agentRule == code
                                                    DropdownMenuItem(
                                                        text = {
                                                            Text(if (active) "✓ $text" else text)
                                                        },
                                                        onClick = {
                                                            rowMenuOpen = false
                                                            viewModel.setProfileDetailAgentRule(cipher, detail.id, code)
                                                        },
                                                    )
                                                }
                                                HorizontalDivider(color = palette.line)
                                                DropdownMenuItem(
                                                    text = { Text("Delete detail", color = palette.red) },
                                                    onClick = {
                                                        rowMenuOpen = false
                                                        viewModel.deleteProfileDetail(cipher, detail.id)
                                                    },
                                                )
                                            }
                                        }
                                    }

                                    if (detail.variants.size > 1) {
                                        Spacer(modifier = Modifier.height(8.dp))
                                        Row(
                                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                                            modifier = Modifier.horizontalScroll(rememberScrollState()),
                                        ) {
                                            detail.variants.forEach { variant ->
                                                val selected = variant.id == detail.selectedVariant?.id
                                                val pillLabel = humanVariantBadge(variant.script, variant.tag)
                                                Surface(
                                                    shape = RoundedCornerShape(8.dp),
                                                    color = if (selected) palette.blueSoft else palette.surfaceSubtle,
                                                    border = BorderStroke(
                                                        1.dp,
                                                        if (selected) palette.blueSoftBorder else palette.line,
                                                    ),
                                                    modifier = Modifier.clickable {
                                                        viewModel.selectDetailVariant(cipher, detail.id, variant.id)
                                                    },
                                                ) {
                                                    Text(
                                                        text = if (pillLabel.isNotBlank()) "$pillLabel · ${variant.value}" else variant.value,
                                                        style = VowkeyTheme.typography.labelSmall,
                                                        color = if (selected) palette.blueInk else palette.muted,
                                                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                                                    )
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Linked Documents
            if (documents.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    VowkeySectionLabel("Documents")
                    VowkeyGroupedCard {
                        documents.forEachIndexed { idx, doc ->
                            if (idx > 0) {
                                HorizontalDivider(
                                    color = palette.line,
                                    modifier = Modifier.padding(start = 16.dp),
                                )
                            }
                            val thumb by produceState<Bitmap?>(initialValue = null, doc.attachmentId) {
                                value = viewModel.loadSourceBitmap(cipher, doc.attachmentId, 0, maxDim = 360)
                            }
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable { onOpenDocument(doc) }
                                    .padding(horizontal = 16.dp, vertical = 12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(12.dp),
                            ) {
                                if (thumb != null) {
                                    Image(
                                        bitmap = thumb!!.asImageBitmap(),
                                        contentDescription = doc.title,
                                        contentScale = ContentScale.Crop,
                                        modifier = Modifier
                                            .width(58.dp)
                                            .height(40.dp)
                                            .clip(RoundedCornerShape(6.dp)),
                                    )
                                } else {
                                    VowkeyKindTile(kind = VowkeyItemKind.DOCUMENT, size = 40.dp)
                                }
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = doc.title,
                                        style = VowkeyTheme.typography.bodyLargeEmphasis,
                                        color = palette.ink,
                                    )
                                    val metaParts = buildList {
                                        add(doc.fileName)
                                        doc.expiresOn?.let { add("Expires $it") }
                                    }
                                    Text(
                                        text = metaParts.joinToString(" · "),
                                        style = VowkeyTheme.typography.bodySmall,
                                        color = if (doc.isExpiringSoon) palette.amber else palette.muted,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                                Icon(
                                    painter = painterResource(VowkeyDrawable.ic_chevron_right),
                                    contentDescription = null,
                                    tint = palette.muted,
                                    modifier = Modifier.size(18.dp),
                                )
                            }
                        }
                    }
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

    if (showRenameDialog) {
        var draftName by remember(cipher.name) { mutableStateOf(cleanName) }
        AlertDialog(
            onDismissRequest = { showRenameDialog = false },
            title = { Text("Rename profile", style = VowkeyTheme.typography.titleMedium) },
            text = {
                VowkeyTextField(
                    label = "Profile name",
                    value = draftName,
                    onValueChange = { draftName = it },
                    cardStyle = CardStyle.Full,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        viewModel.renameProfile(cipher, draftName)
                        showRenameDialog = false
                    },
                ) {
                    Text("Save")
                }
            },
            dismissButton = {
                TextButton(onClick = { showRenameDialog = false }) {
                    Text("Cancel")
                }
            },
        )
    }

    if (editingDetail != null || addingNewDetail) {
        val target = editingDetail
        VowkeyEditProfileDetailDialog(
            existing = target,
            onDismiss = {
                editingDetail = null
                addingNewDetail = false
            },
            onSave = { label, attr, value, script, rule ->
                viewModel.upsertProfileDetail(
                    cipher = cipher,
                    detailId = target?.id,
                    label = label,
                    attribute = attr,
                    value = value,
                    script = script,
                    agentRule = rule,
                )
                editingDetail = null
                addingNewDetail = false
            },
            onDelete = if (target != null) {
                {
                    viewModel.deleteProfileDetail(cipher, target.id)
                    editingDetail = null
                }
            } else {
                null
            },
        )
    }

    largeTypeDetail?.let { detail ->
        AlertDialog(
            onDismissRequest = { largeTypeDetail = null },
            title = { Text(detail.label, style = VowkeyTheme.typography.titleMedium) },
            text = {
                Text(
                    text = detail.currentValue,
                    style = VowkeyTheme.typography.headlineMedium,
                    color = palette.ink,
                )
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        context.copyPlainText(detail.label, detail.currentValue)
                        copiedDetailId = detail.id
                        largeTypeDetail = null
                    },
                ) {
                    Text("Copy")
                }
            },
            dismissButton = {
                TextButton(onClick = { largeTypeDetail = null }) {
                    Text("Done")
                }
            },
        )
    }

    showInDocTarget?.let { activeDetail ->
        VowkeyShowInDocumentModal(
            cipher = cipher,
            allDetails = details.filter { d ->
                val v = d.selectedVariant ?: return@filter false
                if (v.locator == null) false
                else if (v.sourceId != null) documents.any { it.sourceId == v.sourceId }
                else documents.isNotEmpty()
            },
            initialDetail = activeDetail,
            documents = documents,
            viewModel = viewModel,
            onDismiss = { showInDocTarget = null },
        )
    }
}

@Composable
private fun VowkeyEditProfileDetailDialog(
    existing: VowkeyParsedDetail?,
    onDismiss: () -> Unit,
    onSave: (label: String, attribute: String, value: String, script: String?, agentRule: String) -> Unit,
    onDelete: (() -> Unit)?,
) {
    val palette = currentVowkeyPalette()
    var label by remember(existing) { mutableStateOf(existing?.label.orEmpty()) }
    var value by remember(existing) { mutableStateOf(existing?.currentValue.orEmpty()) }
    var agentRule by remember(existing) { mutableStateOf(existing?.agentRule ?: "fill") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = if (existing == null) "Add detail" else "Edit detail",
                style = VowkeyTheme.typography.titleMedium,
            )
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                VowkeyTextField(
                    label = "Detail label",
                    value = label,
                    onValueChange = { label = it },
                    cardStyle = CardStyle.Full,
                )
                VowkeyTextField(
                    label = "Value",
                    value = value,
                    onValueChange = { value = it },
                    cardStyle = CardStyle.Full,
                )
                VowkeySectionLabel("AI access")
                val rules = listOf(
                    "fill" to "Fill without asking",
                    "ask" to "Ask first",
                    "never" to "Don't fill",
                )
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    rules.forEach { (code, text) ->
                        val selected = agentRule == code
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (selected) palette.blueSoft else palette.surfaceSubtle,
                            border = BorderStroke(1.dp, if (selected) palette.blueSoftBorder else palette.line),
                            modifier = Modifier.clickable { agentRule = code },
                        ) {
                            Text(
                                text = text,
                                style = VowkeyTheme.typography.labelSmall,
                                color = if (selected) palette.blueInk else palette.muted,
                                modifier = Modifier.padding(horizontal = 8.dp, vertical = 5.dp),
                            )
                        }
                    }
                }
                if (onDelete != null) {
                    TextButton(onClick = onDelete) {
                        Text("Remove detail", color = palette.red)
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    onSave(
                        label,
                        existing?.attribute.orEmpty(),
                        value,
                        existing?.selectedVariant?.script,
                        agentRule,
                    )
                },
                enabled = value.isNotBlank(),
            ) {
                Text("Save")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyShowInDocumentModal(
    cipher: CipherView,
    allDetails: List<VowkeyParsedDetail>,
    initialDetail: VowkeyParsedDetail,
    documents: List<VowkeyDocumentItem>,
    viewModel: VowkeyWorkspaceViewModel,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var activeDetail by remember(initialDetail.id) { mutableStateOf(initialDetail) }
    var copied by remember { mutableStateOf(false) }

    val variant = activeDetail.selectedVariant
    val locator = variant?.locator
    val doc = remember(variant, documents) {
        if (variant?.sourceId != null) {
            documents.firstOrNull { it.sourceId == variant.sourceId }
        } else {
            documents.firstOrNull()
        }
    }
    val pageIndex = locator?.page ?: 0
    val bitmap by produceState<Bitmap?>(initialValue = null, doc?.attachmentId, pageIndex) {
        if (doc != null) {
            value = viewModel.loadSourceBitmap(cipher, doc.attachmentId, pageIndex, maxDim = 1400)
        }
    }

    LaunchedEffect(copied) {
        if (copied) {
            delay(1400)
            copied = false
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
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Show in document",
                        style = VowkeyTheme.typography.headlineSmall,
                        color = palette.ink,
                    )
                    if (doc != null) {
                        Text(
                            text = "${doc.title} · Page ${pageIndex + 1}",
                            style = VowkeyTheme.typography.bodySmall,
                            color = palette.muted,
                        )
                    }
                }
                VowkeyTextButton(label = "Done", onClick = onDismiss)
            }

            // Document Canvas with Bounding Box Overlay + Pinch-to-Zoom
            val bmp = bitmap
            if (bmp != null) {
                var zoomScale by remember(activeDetail.id) { mutableFloatStateOf(1f) }
                var panX by remember(activeDetail.id) { mutableFloatStateOf(0f) }
                var panY by remember(activeDetail.id) { mutableFloatStateOf(0f) }
                val aspect = (bmp.width.toFloat() / bmp.height.coerceAtLeast(1).toFloat()).coerceIn(0.5f, 2.2f)
                Surface(
                    shape = VowkeyTheme.shapes.actionCard,
                    color = palette.surface,
                    border = BorderStroke(1.dp, palette.line),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(aspect)
                            .clipToBounds()
                            .pointerInput(activeDetail.id) {
                                detectTransformGestures { _, pan, zoom, _ ->
                                    val next = (zoomScale * zoom).coerceIn(1f, 4f)
                                    zoomScale = next
                                    if (next <= 1.02f) {
                                        panX = 0f
                                        panY = 0f
                                    } else {
                                        panX += pan.x
                                        panY += pan.y
                                    }
                                }
                            },
                    ) {
                        Box(
                            modifier = Modifier
                                .fillMaxSize()
                                .graphicsLayer {
                                    scaleX = zoomScale
                                    scaleY = zoomScale
                                    translationX = panX
                                    translationY = panY
                                },
                        ) {
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = doc?.title ?: "Source document",
                                contentScale = ContentScale.FillBounds,
                                modifier = Modifier.fillMaxSize(),
                            )
                            if (locator != null) {
                                val accentColor = palette.blue
                                Canvas(modifier = Modifier.fillMaxSize()) {
                                    val padX = size.width * 0.008f
                                    val padY = size.height * 0.010f
                                    val left = (locator.x * size.width - padX).coerceAtLeast(2f)
                                    val top = (locator.y * size.height - padY).coerceAtLeast(2f)
                                    val boxW = (locator.w * size.width + padX * 2f).coerceAtMost(size.width - left - 2f)
                                    val boxH = (locator.h * size.height + padY * 2f).coerceAtMost(size.height - top - 2f)
                                    drawRoundRect(
                                        color = accentColor.copy(alpha = 0.16f),
                                        topLeft = Offset(left, top),
                                        size = Size(boxW, boxH),
                                        cornerRadius = CornerRadius(14f, 14f),
                                    )
                                    drawRoundRect(
                                        color = accentColor,
                                        topLeft = Offset(left, top),
                                        size = Size(boxW, boxH),
                                        cornerRadius = CornerRadius(14f, 14f),
                                        style = Stroke(width = 3.dp.toPx()),
                                    )
                                }
                            }
                        }
                    }
                }
            } else {
                VowkeyGroupedCard {
                    Text(
                        text = "Source preview unavailable.",
                        style = VowkeyTheme.typography.bodyMedium,
                        color = palette.muted,
                        modifier = Modifier.padding(16.dp),
                    )
                }
            }

            // Active detail card + Copy
            VowkeyGroupedCard {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = activeDetail.label,
                            style = VowkeyTheme.typography.labelMedium,
                            color = palette.muted,
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = activeDetail.currentValue,
                            style = if (activeDetail.isSensitive) {
                                VowkeyTheme.typography.sensitiveInfoSmall
                            } else {
                                VowkeyTheme.typography.bodyLargeEmphasis
                            },
                            color = palette.ink,
                        )
                    }
                    VowkeyOutlinedButton(
                        label = if (copied) "Copied" else "Copy",
                        onClick = {
                            context.copyPlainText(activeDetail.label, activeDetail.currentValue)
                            copied = true
                        },
                    )
                }
            }

            // Located field switcher chips
            if (allDetails.size > 1) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                ) {
                    allDetails.forEach { item ->
                        val selected = item.id == activeDetail.id
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = if (selected) palette.blueSoft else palette.surface,
                            border = BorderStroke(
                                1.dp,
                                if (selected) palette.blueSoftBorder else palette.line,
                            ),
                            modifier = Modifier.clickable { activeDetail = item },
                        ) {
                            Text(
                                text = item.label,
                                style = VowkeyTheme.typography.labelMedium,
                                color = if (selected) palette.blueInk else palette.ink,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}
