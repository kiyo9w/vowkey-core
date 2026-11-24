@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod")

package com.vowkey.app.ui.vowkey

import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.core.content.FileProvider
import com.vowkey.app.data.vault.datasource.disk.FilledFormResult
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.VowkeyMediumTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.vault.CipherView
import java.io.File
import kotlinx.coroutines.launch

internal fun Context.readUriBytesAndMeta(uri: Uri, fallbackName: String): Triple<ByteArray, String, String>? = runCatching {
    val name = contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        val col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (col >= 0 && cursor.moveToFirst()) cursor.getString(col) else null
    }?.takeIf { it.isNotBlank() } ?: fallbackName
    val mime = contentResolver.getType(uri) ?: VowkeyWorkspaceViewModel.guessMimeType(name)
    val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() } ?: return null
    Triple(bytes, name, mime)
}.getOrNull()

internal fun Context.shareFileBytes(bytes: ByteArray, fileName: String, mediaType: String) {
    val shareDir = File(cacheDir, "filled_forms").apply { mkdirs() }
    val outFile = File(shareDir, fileName)
    outFile.writeBytes(bytes)
    val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", outFile)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mediaType
        putExtra(Intent.EXTRA_STREAM, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    startActivity(Intent.createChooser(intent, fileName))
}

internal fun Context.saveImageBytesToGallery(bytes: ByteArray, fileName: String, mediaType: String): Boolean = runCatching {
    val safeMime = if (mediaType.startsWith("image/")) mediaType else "image/png"
    val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
        put(MediaStore.Images.Media.MIME_TYPE, safeMime)
        put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/Vowkey")
        put(MediaStore.Images.Media.IS_PENDING, 1)
    }
    val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: return false
    contentResolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
    values.clear()
    values.put(MediaStore.Images.Media.IS_PENDING, 0)
    contentResolver.update(uri, values, null, null)
    true
}.getOrDefault(false)

@Composable
fun VowkeyDocumentsTabContent(
    state: VowkeyWorkspaceUiState,
    viewModel: VowkeyWorkspaceViewModel,
    modifier: Modifier = Modifier,
) {
    val palette = currentVowkeyPalette()
    val documents = state.documents

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .standardHorizontalMargin()
            .padding(vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        if (documents.isEmpty()) {
            VowkeyGroupedCard {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    VowkeyKindTile(kind = VowkeyItemKind.DOCUMENT, size = 44.dp)
                    Text(
                        text = "Your documents stay on this device",
                        style = VowkeyTheme.typography.headlineSmall,
                        color = palette.ink,
                    )
                    Text(
                        text = "Scan or import a passport, ID card, residence permit, or PDF once. Vowkey keeps the original page so you can verify every detail and fill forms in seconds.",
                        style = VowkeyTheme.typography.bodyMedium,
                        color = palette.muted,
                    )
                    VowkeyFilledButton(
                        label = "Add a document",
                        onClick = { viewModel.openAddDocument(null) },
                        modifier = Modifier.fillMaxWidth(),
                    )
                    VowkeyOutlinedButton(
                        label = "Load sample documents",
                        onClick = { viewModel.loadAllSamples() },
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                VowkeySectionLabel("Source documents (${documents.size})")
                VowkeyGroupedCard {
                    documents.forEachIndexed { idx, doc ->
                        if (idx > 0) {
                            HorizontalDivider(
                                color = palette.line,
                                modifier = Modifier.padding(start = 16.dp),
                            )
                        }
                        val ownerCipher = state.items.firstOrNull { it.id == doc.cipherId }
                        val thumb by produceState<Bitmap?>(initialValue = null, doc.attachmentId) {
                            value = viewModel.loadSourceBitmap(ownerCipher, doc.attachmentId, 0, maxDim = 360)
                        }
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { viewModel.openDocumentDetail(doc.id) }
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
                                        .width(62.dp)
                                        .height(42.dp)
                                        .clip(RoundedCornerShape(6.dp)),
                                )
                            } else {
                                VowkeyKindTile(kind = VowkeyItemKind.DOCUMENT, size = 42.dp)
                            }
                            Column(modifier = Modifier.weight(1f)) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                ) {
                                    Text(
                                        text = doc.title,
                                        style = VowkeyTheme.typography.bodyLargeEmphasis,
                                        color = palette.ink,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                        modifier = Modifier.weight(1f, fill = false),
                                    )
                                    if (doc.isSample) {
                                        VowkeySampleTag()
                                    }
                                }
                                val sub = buildList {
                                    add(doc.profileName)
                                    doc.expiresOn?.let { add("Expires $it") }
                                }.joinToString(" · ")
                                Text(
                                    text = sub,
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
        Spacer(modifier = Modifier.height(16.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyDocumentDetailScreen(
    document: VowkeyDocumentItem,
    ownerCipher: CipherView?,
    viewModel: VowkeyWorkspaceViewModel,
    onBack: () -> Unit,
    onOpenProfile: (String) -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val details = remember(ownerCipher, document.sourceId) {
        if (ownerCipher == null) {
            emptyList()
        } else {
            VowkeyProfileParser.parseDetails(ownerCipher).filter {
                it.selectedVariant?.sourceId == null || it.selectedVariant?.sourceId == document.sourceId
            }
        }
    }
    var selectedDetail by remember(details) {
        mutableStateOf(details.firstOrNull { it.selectedVariant?.locator != null })
    }
    var showInDocDetail by remember { mutableStateOf<VowkeyParsedDetail?>(null) }
    val activePageIndex = selectedDetail?.selectedVariant?.locator?.page ?: 0
    val preview by produceState<Bitmap?>(initialValue = null, document.attachmentId, activePageIndex) {
        value = viewModel.loadSourceBitmap(ownerCipher, document.attachmentId, activePageIndex, maxDim = 1400)
    }
    val scrollState = rememberScrollState()
    val scope = rememberCoroutineScope()

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior()
    VowkeyScaffold(
        modifier = Modifier.nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyMediumTopAppBar(
                title = document.title,
                scrollBehavior = scrollBehavior,
                navigationIcon = NavigationIcon(
                    navigationIcon = rememberVectorPainter(VowkeyDrawable.ic_back),
                    navigationIconContentDescription = "Back",
                    onNavigationIconClick = onBack,
                ),
            )
        },
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .standardHorizontalMargin()
                .padding(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (preview != null) {
                val bmp = preview!!
                val aspect = (bmp.width.toFloat() / bmp.height.coerceAtLeast(1).toFloat()).coerceIn(0.45f, 2.4f)
                val activeLoc = selectedDetail?.selectedVariant?.locator
                Surface(
                    shape = VowkeyTheme.shapes.actionCard,
                    color = palette.surface,
                    border = BorderStroke(1.dp, palette.line),
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable {
                            val target = selectedDetail ?: details.firstOrNull { it.selectedVariant?.locator != null }
                            if (target != null && ownerCipher != null) {
                                showInDocDetail = target
                            }
                        },
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .aspectRatio(aspect),
                    ) {
                        Image(
                            bitmap = bmp.asImageBitmap(),
                            contentDescription = document.title,
                            contentScale = ContentScale.FillBounds,
                            modifier = Modifier.fillMaxSize(),
                        )
                        if (activeLoc != null) {
                            val accentColor = palette.blue
                            Canvas(modifier = Modifier.fillMaxSize()) {
                                val padX = size.width * 0.008f
                                val padY = size.height * 0.010f
                                val left = (activeLoc.x * size.width - padX).coerceAtLeast(2f)
                                val top = (activeLoc.y * size.height - padY).coerceAtLeast(2f)
                                val boxW = (activeLoc.w * size.width + padX * 2f).coerceAtMost(size.width - left - 2f)
                                val boxH = (activeLoc.h * size.height + padY * 2f).coerceAtMost(size.height - top - 2f)
                                drawRoundRect(
                                    color = accentColor.copy(alpha = 0.18f),
                                    topLeft = Offset(left, top),
                                    size = Size(boxW, boxH),
                                    cornerRadius = CornerRadius(12f, 12f),
                                )
                                drawRoundRect(
                                    color = accentColor,
                                    topLeft = Offset(left, top),
                                    size = Size(boxW, boxH),
                                    cornerRadius = CornerRadius(12f, 12f),
                                    style = Stroke(width = 2.8.dp.toPx()),
                                )
                            }
                        }
                        if (selectedDetail != null) {
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = palette.surface.copy(alpha = 0.92f),
                                border = BorderStroke(1.dp, palette.line),
                                modifier = Modifier
                                    .align(Alignment.BottomStart)
                                    .padding(10.dp),
                            ) {
                                Text(
                                    text = "${selectedDetail!!.label}: ${selectedDetail!!.currentValue}",
                                    style = VowkeyTheme.typography.labelSmall,
                                    color = palette.ink,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                )
                            }
                        }
                    }
                }
            }

            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                VowkeyFilledButton(
                    label = "Fill form",
                    onClick = { viewModel.openFillForm(document.cipherId) },
                    modifier = Modifier.weight(1f),
                )
                VowkeyOutlinedButton(
                    label = "Open profile",
                    onClick = { onOpenProfile(document.cipherId) },
                    modifier = Modifier.weight(1f),
                )
            }

            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                VowkeySectionLabel("Document info")
                VowkeyGroupedCard {
                    Column(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        DocInfoRow("Profile", document.profileName)
                        DocInfoRow("File", document.fileName)
                        document.expiresOn?.let { DocInfoRow("Expires", it) }
                        document.documentDate?.let { DocInfoRow("Issued", it) }
                    }
                }
            }

            if (details.isNotEmpty()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    VowkeySectionLabel("Extracted details")
                    VowkeyGroupedCard {
                        details.forEachIndexed { idx, detail ->
                            if (idx > 0) {
                                HorizontalDivider(
                                    color = palette.line,
                                    modifier = Modifier.padding(start = 16.dp),
                                )
                            }
                            val isHighlighted = selectedDetail?.id == detail.id
                            val hasLoc = detail.selectedVariant?.locator != null
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(if (isHighlighted) palette.blueSoft.copy(alpha = 0.45f) else Color.Transparent)
                                    .clickable {
                                        if (hasLoc) {
                                            selectedDetail = detail
                                            scope.launch { scrollState.animateScrollTo(0) }
                                        } else {
                                            context.copyPlainText(detail.label, detail.currentValue)
                                        }
                                    }
                                    .padding(horizontal = 16.dp, vertical = 11.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = detail.label,
                                        style = VowkeyTheme.typography.labelMedium,
                                        color = if (isHighlighted) palette.blueInk else palette.muted,
                                    )
                                    Text(
                                        text = detail.currentValue,
                                        style = if (detail.isSensitive) {
                                            VowkeyTheme.typography.sensitiveInfoSmall
                                        } else {
                                            VowkeyTheme.typography.bodyLargeEmphasis
                                        },
                                        color = palette.ink,
                                    )
                                }
                                IconButton(
                                    onClick = { context.copyPlainText(detail.label, detail.currentValue) },
                                    modifier = Modifier.size(34.dp),
                                ) {
                                    Icon(
                                        painter = painterResource(VowkeyDrawable.ic_copy),
                                        contentDescription = "Copy",
                                        tint = palette.iconPrimary,
                                        modifier = Modifier.size(17.dp),
                                    )
                                }
                                if (hasLoc && ownerCipher != null) {
                                    IconButton(
                                        onClick = { showInDocDetail = detail },
                                        modifier = Modifier.size(34.dp),
                                    ) {
                                        Icon(
                                            painter = painterResource(VowkeyDrawable.ic_search),
                                            contentDescription = "Show in document",
                                            tint = palette.iconSecondary,
                                            modifier = Modifier.size(18.dp),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Spacer(modifier = Modifier.height(16.dp))
        }
    }

    if (showInDocDetail != null && ownerCipher != null) {
        VowkeyShowInDocumentModal(
            cipher = ownerCipher,
            allDetails = details.filter { it.selectedVariant?.locator != null },
            initialDetail = showInDocDetail!!,
            documents = listOf(document),
            viewModel = viewModel,
            onDismiss = { showInDocDetail = null },
        )
    }
}

@Composable
private fun DocInfoRow(label: String, value: String) {
    val palette = currentVowkeyPalette()
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(text = label, style = VowkeyTheme.typography.bodyMedium, color = palette.muted)
        Text(text = value, style = VowkeyTheme.typography.bodyMediumEmphasis, color = palette.ink)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyAddDocumentSheet(
    profiles: List<CipherView>,
    initialProfileId: String?,
    busy: Boolean,
    errorMessage: String? = null,
    onDismissError: () -> Unit = {},
    viewModel: VowkeyWorkspaceViewModel,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var targetProfileId by remember(initialProfileId) { mutableStateOf(initialProfileId) }
    var profileName by remember { mutableStateOf("") }
    var pendingCameraFile by remember { mutableStateOf<File?>(null) }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pendingCameraFile
        if (ok && file != null && file.exists()) {
            viewModel.captureDocumentBytes(profileName, targetProfileId, file.readBytes(), file.name, "image/jpeg")
        }
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            context.readUriBytesAndMeta(uri, "document-photo.jpg")?.let { (bytes, fName, mime) ->
                viewModel.captureDocumentBytes(profileName, targetProfileId, bytes, fName, mime)
            }
        }
    }
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            context.readUriBytesAndMeta(uri, "document.pdf")?.let { (bytes, fName, mime) ->
                viewModel.captureDocumentBytes(profileName, targetProfileId, bytes, fName, mime)
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
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
                        text = "Add document",
                        style = VowkeyTheme.typography.headlineSmall,
                        color = palette.ink,
                    )
                    Text(
                        text = "Scan or choose a passport, ID card, PDF, or Office file to extract profile details.",
                        style = VowkeyTheme.typography.bodyMedium,
                        color = palette.muted,
                    )
                }
                VowkeyTextButton(label = "Cancel", onClick = onDismiss, isEnabled = !busy)
            }

            if (busy) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
                    Text(
                        text = "Reading document…",
                        style = VowkeyTheme.typography.bodyMediumEmphasis,
                        color = palette.ink,
                    )
                }
            }

            if (errorMessage != null) {
                Surface(
                    shape = VowkeyTheme.shapes.infoCallout,
                    color = palette.redSoft,
                    border = BorderStroke(1.dp, palette.redBorder),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = errorMessage,
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.red,
                            modifier = Modifier.weight(1f),
                        )
                        VowkeyTextButton(label = "Dismiss", onClick = onDismissError)
                    }
                }
            }

            val chipShape = RoundedCornerShape(8.dp)
            if (profiles.isNotEmpty()) {
                VowkeySectionLabel("Save into profile")
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.horizontalScroll(rememberScrollState()),
                ) {
                    val isNew = targetProfileId == null
                    Surface(
                        shape = chipShape,
                        color = if (isNew) palette.blueSoft else palette.surface,
                        border = BorderStroke(1.dp, if (isNew) palette.blueSoftBorder else palette.line),
                        modifier = Modifier.clickable { targetProfileId = null },
                    ) {
                        Text(
                            text = "New profile",
                            style = VowkeyTheme.typography.labelMedium,
                            color = if (isNew) palette.blueInk else palette.ink,
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                        )
                    }
                    profiles.forEach { prof ->
                        val selected = targetProfileId == prof.id
                        Surface(
                            shape = chipShape,
                            color = if (selected) palette.blueSoft else palette.surface,
                            border = BorderStroke(1.dp, if (selected) palette.blueSoftBorder else palette.line),
                            modifier = Modifier.clickable { targetProfileId = prof.id },
                        ) {
                            Text(
                                text = VowkeyMobileFormat.displayName(prof.name),
                                style = VowkeyTheme.typography.labelMedium,
                                color = if (selected) palette.blueInk else palette.ink,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
            }

            if (targetProfileId == null) {
                VowkeyTextField(
                    label = "Profile name (optional)",
                    value = profileName,
                    onValueChange = { profileName = it },
                    cardStyle = CardStyle.Full,
                )
            }

            VowkeyGroupedCard {
                VowkeySheetActionRow(
                    iconRes = VowkeyDrawable.ic_camera,
                    title = "Take photo",
                    enabled = !busy,
                    onClick = {
                        val dir = File(context.filesDir, "camera_temp").apply { mkdirs() }
                        val photoFile = File.createTempFile("vk_doc_", ".jpg", dir)
                        pendingCameraFile = photoFile
                        val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photoFile)
                        cameraLauncher.launch(uri)
                    },
                )
                HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 58.dp))
                VowkeySheetActionRow(
                    iconRes = VowkeyDrawable.ic_id_card,
                    title = "Choose photo",
                    enabled = !busy,
                    onClick = {
                        photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    },
                )
                HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 58.dp))
                VowkeySheetActionRow(
                    iconRes = VowkeyDrawable.ic_file_text,
                    title = "Choose a file",
                    subtitle = "PDF, Word, Excel or HWPX",
                    enabled = !busy,
                    onClick = {
                        fileLauncher.launch(
                            arrayOf(
                                "image/*",
                                "application/pdf",
                                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                "application/octet-stream",
                            ),
                        )
                    },
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VowkeyFillFormSheet(
    profiles: List<CipherView>,
    initialProfileId: String?,
    filledResult: FilledFormResult?,
    busy: Boolean,
    errorMessage: String?,
    hasLoadedForm: Boolean,
    viewModel: VowkeyWorkspaceViewModel,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val palette = currentVowkeyPalette()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    var selectedProfileId by remember(initialProfileId, profiles) {
        mutableStateOf(initialProfileId ?: profiles.firstOrNull()?.id)
    }
    var pendingFormCameraFile by remember { mutableStateOf<File?>(null) }
    var showZoomViewer by remember { mutableStateOf(false) }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val file = pendingFormCameraFile
        if (ok && file != null && file.exists()) {
            viewModel.fillFormBytes(selectedProfileId, file.readBytes(), file.name, "image/jpeg")
        }
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            context.readUriBytesAndMeta(uri, "form-photo.jpg")?.let { (bytes, fName, mime) ->
                viewModel.fillFormBytes(selectedProfileId, bytes, fName, mime)
            }
        }
    }
    val fileLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            context.readUriBytesAndMeta(uri, "form.pdf")?.let { (bytes, fName, mime) ->
                viewModel.fillFormBytes(selectedProfileId, bytes, fName, mime)
            }
        }
    }

    ModalBottomSheet(
        onDismissRequest = { if (!busy) onDismiss() },
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
                        text = "Fill form",
                        style = VowkeyTheme.typography.headlineSmall,
                        color = palette.ink,
                    )
                }
                VowkeyTextButton(label = "Done", onClick = onDismiss, isEnabled = !busy)
            }

            val chipShape = RoundedCornerShape(8.dp)
            if (profiles.isNotEmpty()) {
                VowkeySectionLabel("Whose details")
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .horizontalScroll(rememberScrollState())
                        .selectableGroup(),
                ) {
                    profiles.forEach { prof ->
                        val selected = selectedProfileId == prof.id
                        Surface(
                            shape = chipShape,
                            color = if (selected) palette.blueSoft else palette.surface,
                            border = BorderStroke(1.dp, if (selected) palette.blueSoftBorder else palette.line),
                            modifier = Modifier.selectable(
                                selected = selected,
                                enabled = !busy,
                                role = Role.RadioButton,
                            ) {
                                if (selectedProfileId != prof.id) {
                                    selectedProfileId = prof.id
                                    if (hasLoadedForm) {
                                        viewModel.refillLastForm(prof.id)
                                    }
                                }
                            },
                        ) {
                            Text(
                                text = VowkeyMobileFormat.displayName(prof.name),
                                style = VowkeyTheme.typography.labelMedium,
                                color = if (selected) palette.blueInk else palette.ink,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                            )
                        }
                    }
                }
            }

            if (busy) {
                Surface(
                    shape = VowkeyTheme.shapes.actionCard,
                    color = palette.surface,
                    border = BorderStroke(1.dp, palette.line),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 16.dp, vertical = 14.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.2.dp)
                        Column {
                            Text(
                                text = "Detecting fields and placing text…",
                                style = VowkeyTheme.typography.bodyMediumEmphasis,
                                color = palette.ink,
                            )
                        }
                    }
                }
            }

            if (errorMessage != null) {
                VowkeyGroupedCard {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Text(
                            text = errorMessage,
                            style = VowkeyTheme.typography.bodyMedium,
                            color = palette.red,
                        )
                        if (hasLoadedForm) {
                            VowkeyOutlinedButton(
                                label = "Try again",
                                onClick = { viewModel.refillLastForm(selectedProfileId) },
                                isEnabled = !busy,
                            )
                        }
                    }
                }
            }

            if (filledResult != null) {
                Surface(
                    shape = VowkeyTheme.shapes.infoCallout,
                    color = palette.greenSoft,
                    border = BorderStroke(1.dp, palette.greenBorder),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(
                        text = "Filled ${filledResult.filledCount} fields",
                        style = VowkeyTheme.typography.bodyMediumEmphasis,
                        color = palette.greenText,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp),
                    )
                }

                filledResult.previewBitmap?.let { bmp ->
                    Surface(
                        shape = VowkeyTheme.shapes.actionCard,
                        color = palette.surface,
                        border = BorderStroke(1.dp, palette.line),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { showZoomViewer = true },
                    ) {
                        Box(modifier = Modifier.fillMaxWidth()) {
                            Image(
                                bitmap = bmp.asImageBitmap(),
                                contentDescription = filledResult.fileName,
                                contentScale = ContentScale.FillWidth,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = palette.ink.copy(alpha = 0.78f),
                                modifier = Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(10.dp),
                            ) {
                                Text(
                                    text = "View full screen",
                                    style = VowkeyTheme.typography.labelSmall,
                                    color = palette.canvas,
                                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                )
                            }
                        }
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    if (filledResult.mediaType.startsWith("image/")) {
                        VowkeyOutlinedButton(
                            label = "Save to Gallery",
                            onClick = {
                                val ok = context.saveImageBytesToGallery(
                                    filledResult.bytes,
                                    filledResult.fileName,
                                    filledResult.mediaType,
                                )
                                Toast.makeText(
                                    context,
                                    if (ok) "Saved to Gallery" else "Couldn't save image",
                                    Toast.LENGTH_SHORT,
                                ).show()
                            },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    VowkeyFilledButton(
                        label = "Share filled form",
                        onClick = {
                            context.shareFileBytes(filledResult.bytes, filledResult.fileName, filledResult.mediaType)
                        },
                        modifier = Modifier.weight(1f),
                    )
                }

                VowkeyTextButton(
                    label = "Fill another form",
                    onClick = { viewModel.clearFilledForm() },
                    modifier = Modifier.align(Alignment.CenterHorizontally),
                    isEnabled = !busy,
                )
            }

            if (filledResult == null) {
                VowkeySectionLabel("Choose a blank form")
                VowkeyGroupedCard {
                    VowkeySheetActionRow(
                        iconRes = VowkeyDrawable.ic_camera,
                        title = "Take photo of paper form",
                        enabled = !busy,
                        onClick = {
                            val dir = File(context.filesDir, "camera_temp").apply { mkdirs() }
                            val photoFile = File.createTempFile("vk_form_", ".jpg", dir)
                            pendingFormCameraFile = photoFile
                            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", photoFile)
                            cameraLauncher.launch(uri)
                        },
                    )
                    HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 58.dp))
                    VowkeySheetActionRow(
                        iconRes = VowkeyDrawable.ic_id_card,
                        title = "Choose form photo",
                        enabled = !busy,
                        onClick = {
                            photoLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                        },
                    )
                    HorizontalDivider(color = palette.line, modifier = Modifier.padding(start = 58.dp))
                    VowkeySheetActionRow(
                        iconRes = VowkeyDrawable.ic_file_text,
                        title = "Choose a file",
                        subtitle = "PDF, Word, Excel or HWPX",
                        enabled = !busy,
                        onClick = {
                            fileLauncher.launch(
                                arrayOf(
                                    "image/*",
                                    "application/pdf",
                                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                    "application/octet-stream",
                                ),
                            )
                        },
                    )
                }
            }
        }
    }

    if (showZoomViewer && filledResult?.previewBitmap != null) {
        VowkeyFilledFormZoomDialog(
            filledResult = filledResult,
            onDismiss = { showZoomViewer = false },
        )
    }
}

@Composable
private fun VowkeySheetActionRow(
    iconRes: Int,
    title: String,
    subtitle: String? = null,
    enabled: Boolean = true,
    onClick: () -> Unit,
) {
    val palette = currentVowkeyPalette()
    val tileShape = RoundedCornerShape(9.dp)
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(
            modifier = Modifier
                .size(34.dp)
                .clip(tileShape)
                .background(palette.blueSoft)
                .padding(0.dp),
            contentAlignment = Alignment.Center,
        ) {
            Icon(
                painter = painterResource(iconRes),
                contentDescription = null,
                tint = palette.blueInk,
                modifier = Modifier.size(18.dp),
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = VowkeyTheme.typography.bodyLargeEmphasis,
                color = if (enabled) palette.ink else palette.muted,
            )
            if (!subtitle.isNullOrBlank()) {
                Text(
                    text = subtitle,
                    style = VowkeyTheme.typography.bodySmall,
                    color = palette.muted,
                )
            }
        }
        Icon(
            painter = painterResource(VowkeyDrawable.ic_chevron_right),
            contentDescription = null,
            tint = palette.muted,
            modifier = Modifier.size(18.dp),
        )
    }
}

@Composable
private fun VowkeyFilledFormZoomDialog(
    filledResult: FilledFormResult,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    var showOriginal by remember { mutableStateOf(false) }
    var scale by remember { mutableFloatStateOf(1f) }
    var offsetX by remember { mutableFloatStateOf(0f) }
    var offsetY by remember { mutableFloatStateOf(0f) }

    val activeBitmap = if (showOriginal && filledResult.originalPreviewBitmap != null) {
        filledResult.originalPreviewBitmap
    } else {
        filledResult.previewBitmap ?: return
    }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color(0xFF0E1116)),
        ) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .clipToBounds()
                    .pointerInput(Unit) {
                        detectTapGestures(
                            onDoubleTap = {
                                if (scale > 1.2f) {
                                    scale = 1f
                                    offsetX = 0f
                                    offsetY = 0f
                                } else {
                                    scale = 2.5f
                                }
                            },
                        )
                    }
                    .pointerInput(Unit) {
                        detectTransformGestures { _, pan, zoom, _ ->
                            val nextScale = (scale * zoom).coerceIn(1f, 5f)
                            scale = nextScale
                            if (nextScale <= 1.02f) {
                                offsetX = 0f
                                offsetY = 0f
                            } else {
                                offsetX += pan.x
                                offsetY += pan.y
                            }
                        }
                    },
                contentAlignment = Alignment.Center,
            ) {
                Image(
                    bitmap = activeBitmap.asImageBitmap(),
                    contentDescription = filledResult.fileName,
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .fillMaxSize()
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            translationX = offsetX
                            translationY = offsetY
                        },
                )
            }

            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .statusBarsPadding()
                    .padding(horizontal = 14.dp, vertical = 12.dp)
                    .align(Alignment.TopCenter),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = Color.White.copy(alpha = 0.14f),
                    modifier = Modifier.clickable(onClick = onDismiss),
                ) {
                    Text(
                        text = "Close",
                        style = VowkeyTheme.typography.labelMedium,
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                    )
                }

                if (filledResult.originalPreviewBitmap != null) {
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        listOf(false to "Filled", true to "Original").forEach { (orig, label) ->
                            val active = showOriginal == orig
                            Surface(
                                shape = RoundedCornerShape(8.dp),
                                color = if (active) Color.White else Color.White.copy(alpha = 0.14f),
                                modifier = Modifier.clickable { showOriginal = orig },
                            ) {
                                Text(
                                    text = label,
                                    style = VowkeyTheme.typography.labelMedium,
                                    color = if (active) Color(0xFF0E1116) else Color.White,
                                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 7.dp),
                                )
                            }
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (filledResult.mediaType.startsWith("image/")) {
                        Surface(
                            shape = RoundedCornerShape(8.dp),
                            color = Color.White.copy(alpha = 0.14f),
                            modifier = Modifier.clickable {
                                val ok = context.saveImageBytesToGallery(
                                    filledResult.bytes,
                                    filledResult.fileName,
                                    filledResult.mediaType,
                                )
                                Toast.makeText(
                                    context,
                                    if (ok) "Saved to Gallery" else "Couldn't save image",
                                    Toast.LENGTH_SHORT,
                                ).show()
                            },
                        ) {
                            Text(
                                text = "Save",
                                style = VowkeyTheme.typography.labelMedium,
                                color = Color.White,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                            )
                        }
                    }
                    Surface(
                        shape = RoundedCornerShape(8.dp),
                        color = Color.White,
                        modifier = Modifier.clickable {
                            context.shareFileBytes(filledResult.bytes, filledResult.fileName, filledResult.mediaType)
                        },
                    ) {
                        Text(
                            text = "Share",
                            style = VowkeyTheme.typography.labelMedium,
                            color = Color(0xFF0E1116),
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        )
                    }
                }
            }
        }
    }
}
