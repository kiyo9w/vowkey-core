@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod", "TooGenericExceptionCaught")

package com.vowkey.app.data.vault.datasource.disk

import android.graphics.Bitmap
import com.vowkey.app.data.auth.datasource.disk.AuthDiskSource
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.sdk.captureDecisionBegin
import com.vowkey.sdk.captureDecisionFinish
import com.vowkey.sdk.captureDecisionRequests
import com.vowkey.sdk.captureDecisionTakeFirstAnswers
import com.vowkey.sdk.captureDecodeBarcode
import com.vowkey.sdk.captureDocumentText
import com.vowkey.sdk.captureExtractOffice
import com.vowkey.sdk.captureFillForm
import com.vowkey.sdk.captureFillOfficeBytes
import com.vowkey.sdk.captureFormBegin
import com.vowkey.sdk.captureFormChoices
import com.vowkey.sdk.captureFormRequests
import com.vowkey.sdk.captureFormTakeFirstAnswers
import com.vowkey.sdk.captureProfilesFromFlat
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.Year
import java.util.UUID
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.*

data class CapturedDocumentResult(
    val details: Map<String, String>,
    val locators: Map<String, JsonElement>,
    val sourceRecord: JsonObject,
)

data class FilledFormResult(
    val bytes: ByteArray,
    val fileName: String,
    val mediaType: String,
    val filledCount: Int,
    val previewBitmap: Bitmap?,
    val originalPreviewBitmap: Bitmap? = null,
)

class GuestDecision(
    private val json: Json,
    private val store: LocalVaultStore,
    private val auth: AuthDiskSource,
    private val environment: EnvironmentRepository,
    private val ocr: DocumentOcrEngine = object : DocumentOcrEngine {
        override suspend fun recognize(bitmap: Bitmap): List<OcrPiece> = emptyList()
    },
) {
    private var guestToken: String? = null
    private var expiresAt = 0L

    var onDeviceOnly: Boolean
        get() = runCatching {
            store.unlock()
            store.side("prefs", "on_device_only") == "1"
        }.getOrDefault(false)
        set(value) {
            runCatching {
                store.unlock()
                store.writeSide("prefs", "on_device_only", if (value) "1" else "0")
            }
        }

    suspend fun document(reading: JsonObject, year: Int): JsonElement = withContext(Dispatchers.IO) {
        check(!onDeviceOnly) { "On-device only mode is active." }
        var plan = captureDecisionBegin(reading.toString(), 0u)
        plan = captureDecisionTakeFirstAnswers(plan, answers(captureDecisionRequests(plan, false)))
        json.parseToJsonElement(captureDecisionFinish(plan, answers(captureDecisionRequests(plan, true)), "", year.toUShort()))
    }

    suspend fun form(fields: JsonArray, held: Set<String>): JsonElement = withContext(Dispatchers.IO) {
        check(!onDeviceOnly) { "On-device only mode is active." }
        var plan = captureFormBegin(buildJsonObject {
            put("fields", fields); put("held", JsonArray(held.map(::JsonPrimitive)))
        }.toString(), 0u)
        plan = captureFormTakeFirstAnswers(plan, answers(captureFormRequests(plan, false)))
        json.parseToJsonElement(captureFormChoices(plan, answers(captureFormRequests(plan, true))))
    }

    suspend fun readDocumentBytes(
        bytes: ByteArray,
        fileName: String,
        mediaType: String,
        cacheDir: File,
    ): CapturedDocumentResult = withContext(Dispatchers.IO) {
        val currentYear = Year.now().value
        val attachmentId = UUID.randomUUID().toString()
        runCatching {
            val file = store.attachmentFile(attachmentId)
            file.parentFile?.mkdirs()
            file.writeBytes(bytes)
        }
        val sourceRecord = buildJsonObject {
            put("id", attachmentId)
            put("kind", "document")
            put("title", fileName.substringBeforeLast('.').ifBlank { "Document" })
            put("fileName", fileName)
            put("mediaType", mediaType)
            put("attachmentId", attachmentId)
            put("capturedAt", Instant.now().toString())
        }

        if (AndroidDocumentEngine.isOfficeFileName(fileName)) {
            val extracted = json.parseToJsonElement(captureExtractOffice(bytes, fileName)).jsonObject
            val pages = extracted["pages"]?.jsonArray ?: JsonArray(emptyList())
            val plainText = extracted["text"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val reading = buildJsonObject { put("pages", pages) }
            val captured = runCatching { document(reading, currentYear).jsonObject }.getOrNull()
            val details = linkedMapOf<String, String>()
            val locators = linkedMapOf<String, JsonElement>()
            captured?.get("details")?.jsonObject?.forEach { (k, v) ->
                v.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }?.let { details[k] = it }
            }
            captured?.get("locators")?.jsonObject?.forEach { (k, v) -> locators[k] = v }
            if (details.isEmpty() && plainText.isNotBlank()) {
                val local = json.parseToJsonElement(captureDocumentText(plainText, currentYear.toUShort())).jsonObject
                local["details"]?.jsonObject?.forEach { (k, v) ->
                    v.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }?.let { details[k] = it }
                }
            }
            return@withContext CapturedDocumentResult(details, locators, sourceRecord)
        }

        val isPdf = AndroidDocumentEngine.isPdf(bytes, fileName, mediaType)
        val barcodeDetails = linkedMapOf<String, String>()
        if (!isPdf) {
            runCatching {
                val decoded = json.parseToJsonElement(captureDecodeBarcode(bytes)).jsonObject
                decoded["details"]?.jsonObject?.forEach { (k, v) ->
                    v.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }?.let { barcodeDetails[k] = it }
                }
            }
        }

        val pages = AndroidDocumentEngine.decodePages(bytes, fileName, mediaType, cacheDir, ocr, maxPages = 4)
        try {
            val readingPages = JsonArray(
                pages.map { page ->
                    buildJsonObject {
                        put("index", page.index)
                        put("aspect", page.aspect)
                        put(
                            "pieces",
                            JsonArray(
                                page.pieces.map { p ->
                                    buildJsonObject {
                                        put("text", p.text)
                                        put("x", p.left)
                                        put("y", p.top)
                                        put("w", p.width)
                                        put("h", p.height)
                                        put("confidence", p.confidence)
                                    }
                                },
                            ),
                        )
                    }
                },
            )
            val reading = buildJsonObject { put("pages", readingPages) }
            val plainText = pages.joinToString("\n") { p -> p.pieces.joinToString(" ") { it.text } }

            val localOnly = onDeviceOnly
            val (decisionObj, visionList) = coroutineScope {
                val decDeferred = async {
                    if (!localOnly && pages.any { it.pieces.isNotEmpty() }) {
                        runCatching { document(reading, currentYear).jsonObject }.getOrNull()
                    } else {
                        null
                    }
                }
                val visDeferred = async {
                    if (localOnly) {
                        emptyList()
                    } else {
                        pages.take(2).mapNotNull { page ->
                            runCatching {
                                val dataUrl = AndroidDocumentEngine.bitmapToJpegDataUrl(page.bitmap)
                                postWithAuth(
                                    "https://decision.vowkey.app/v1/documents/read-vision",
                                    buildJsonObject {
                                        put("v", 1)
                                        put("imageDataUrl", dataUrl)
                                        put("fileName", fileName)
                                    },
                                )
                            }.getOrNull()?.let { page.index to it }
                        }
                    }
                }
                decDeferred.await() to visDeferred.await()
            }

            val mergedDetails = linkedMapOf<String, String>()
            val mergedLocators = linkedMapOf<String, JsonElement>()

            decisionObj?.get("details")?.jsonObject?.forEach { (k, v) ->
                v.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }?.let { mergedDetails[k] = it }
            }
            decisionObj?.get("locators")?.jsonObject?.forEach { (k, v) ->
                mergedLocators[k] = v
            }

            // Vision reads 2D tables, seals, handwritten notes, and multi-member household rows directly from pixels.
            for ((pageIdx, vis) in visionList) {
                vis["details"]?.jsonObject?.forEach { (k, v) ->
                    val str = v.jsonPrimitive.contentOrNull?.trim().orEmpty()
                    if (str.isNotEmpty()) mergedDetails[k] = str
                }
                vis["locators"]?.jsonObject?.forEach { (k, v) ->
                    val obj = v as? JsonObject
                    if (obj != null && pageIdx > 0) {
                        mergedLocators[k] = JsonObject(obj + ("page" to JsonPrimitive(pageIdx)))
                    } else {
                        mergedLocators[k] = v
                    }
                }
            }

            // Authoritative machine-readable barcode values override OCR/VLM typos.
            barcodeDetails.forEach { (k, v) -> mergedDetails[k] = v }

            if ((mergedDetails.isEmpty() || localOnly) && plainText.isNotBlank()) {
                runCatching {
                    val local = json.parseToJsonElement(captureDocumentText(plainText, currentYear.toUShort())).jsonObject
                    local["details"]?.jsonObject?.forEach { (k, v) ->
                        v.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }?.let {
                            mergedDetails.putIfAbsent(k, it)
                        }
                    }
                }
            }

            attachLocalPieceLocators(mergedDetails, mergedLocators, pages)

            val inferredKind = inferDocumentKind(mergedDetails, fileName)
            val expiryVal = listOf("id.passport.expiry", "id.card.expiry", "visa.expiry")
                .firstNotNullOfOrNull { mergedDetails[it]?.takeIf(String::isNotBlank) }
            val enrichedSource = buildJsonObject {
                sourceRecord.forEach { (k, v) -> put(k, v) }
                if (!inferredKind.isNullOrBlank()) {
                    put("documentKind", inferredKind)
                    put("title", inferredKind)
                } else {
                    put("title", humanDocumentTitle(sourceRecord, fileName))
                }
                if (!expiryVal.isNullOrBlank()) {
                    put("expiresOn", expiryVal)
                }
            }

            CapturedDocumentResult(mergedDetails, mergedLocators, enrichedSource)
        } finally {
            pages.forEach { it.bitmap.recycle() }
        }
    }

    suspend fun fillFormBytes(
        bytes: ByteArray,
        fileName: String,
        mediaType: String,
        cacheDir: File,
        profiles: List<CipherView>,
        selectedProfileId: String?,
        cards: List<CipherView> = emptyList(),
    ): FilledFormResult = withContext(Dispatchers.IO) {
        val usable = profiles.filter { it.type == CipherType.IDENTITY && it.isNativeProfileUsableForFill() }
        val primary = usable.firstOrNull { it.id == selectedProfileId }
            ?: usable.firstOrNull()
            ?: error("Add a profile before filling a form.")
        val (roleProfiles, flatDetails) = buildRoleProfiles(primary, usable, cards)

        if (AndroidDocumentEngine.isOfficeFileName(fileName)) {
            val filledBytes = captureFillOfficeBytes(bytes, fileName, json.encodeToString(flatDetails))
            val outName = buildFilledFileName(fileName, defaultExt = fileName.substringAfterLast('.', "docx"))
            return@withContext FilledFormResult(
                bytes = filledBytes,
                fileName = outName,
                mediaType = mediaType.ifBlank { "application/octet-stream" },
                filledCount = flatDetails.size.coerceAtLeast(1),
                previewBitmap = null,
            )
        }

        val localOnly = onDeviceOnly
        val isPdf = AndroidDocumentEngine.isPdf(bytes, fileName, mediaType)
        val pages = AndroidDocumentEngine.decodePages(bytes, fileName, mediaType, cacheDir, ocr, maxPages = 8)
        try {
            val lumas = pages.map { AndroidDocumentEngine.extractLuma(it.bitmap) }
            val pageSlots = pages.mapIndexed { idx, page ->
                AndroidDocumentEngine.detectFormSlots(page, lumas[idx])
            }
            val allSlots = pageSlots.flatten()
            val fieldInputs = allSlots.map { slot ->
                buildJsonObject {
                    put("id", slot.id)
                    put("name", "")
                    put("label", slot.label)
                    put("placeholder", "")
                    put("autocomplete", "")
                    put("input_type", slot.input_type)
                    put("section", slot.section)
                    put("form", "")
                    put("pattern", "")
                    put("max_length", slot.max_length)
                    put("format", slot.format)
                    put("op_ignore", false)
                    put("options", JsonArray(slot.options.map(::JsonPrimitive)))
                }
            }

            val profilesJsonStr = json.encodeToString(roleProfiles)
            var matches = if (fieldInputs.isNotEmpty()) {
                json.parseToJsonElement(
                    captureFillForm(JsonArray(fieldInputs).toString(), profilesJsonStr, "[]", true),
                ).jsonArray
            } else {
                JsonArray(emptyList())
            }

            val snappedByPage = linkedMapOf<Int, List<AndroidDocumentEngine.SnappedFill>>()
            if (!localOnly) {
                val snappedResults = coroutineScope {
                    pages.take(3).mapIndexed { idx, page ->
                        async {
                            val plannedItems = run {
                                val dataUrl = AndroidDocumentEngine.bitmapToJpegDataUrl(page.bitmap)
                                val resp = postWithAuth(
                                    "https://decision.vowkey.app/v1/forms/fill-image",
                                    buildJsonObject {
                                        put("v", 1)
                                        put("imageDataUrl", dataUrl)
                                        put("fileName", fileName)
                                        put(
                                            "details",
                                            buildJsonObject {
                                                flatDetails.forEach { (k, v) -> if (v.isNotBlank()) put(k, v) }
                                            },
                                        )
                                    },
                                )
                                resp["fields"]?.jsonArray.orEmpty().mapNotNull { el ->
                                    val o = el.jsonObject
                                    val boxArr = o["box"]?.jsonArray?.mapNotNull { it.jsonPrimitive.doubleOrNull }
                                        ?: return@mapNotNull null
                                    if (boxArr.size != 4) return@mapNotNull null
                                    val v = o["value"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                                    if (v.isEmpty()) return@mapNotNull null
                                    AndroidDocumentEngine.PlannedFill(
                                        key = o["sourceKey"]?.jsonPrimitive?.contentOrNull
                                            ?: o["key"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                                        value = v,
                                        action = o["action"]?.jsonPrimitive?.contentOrNull ?: "text",
                                        box = boxArr,
                                        comb = o["comb"]?.jsonPrimitive?.intOrNull,
                                        label = o["label"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                                    )
                                }
                            }
                            if (plannedItems.isNotEmpty()) {
                                page.index to AndroidDocumentEngine.snapPlannedFills(page, lumas[idx], plannedItems)
                            } else {
                                null
                            }
                        }
                    }.awaitAll()
                }
                snappedResults.filterNotNull().forEach { (pageIdx, snapped) ->
                    snappedByPage[pageIdx] = snapped
                }
            }

            val unresolvedIndices = if (localOnly) {
                emptyList()
            } else {
                allSlots.indices.filter { idx ->
                    val slot = allSlots[idx]
                    val pageNum = slot.id.split(':').getOrNull(1)?.toIntOrNull() ?: 0
                    val pageSnappedCount = snappedByPage[pageNum]?.size ?: 0
                    if (pageSnappedCount >= 5) {
                        val isStructured = slot.format.startsWith("comb:") ||
                            slot.id.contains(":comb:")
                        if (!isStructured) return@filter false
                    }
                    val m = matches.getOrNull(idx)?.jsonObject
                    val score = m?.get("score")?.jsonPrimitive?.doubleOrNull ?: 0.0
                    val value = m?.get("value")?.jsonPrimitive?.contentOrNull.orEmpty()
                    score < 0.85 || value.isBlank()
                }
            }

            if (unresolvedIndices.isNotEmpty()) {
                val choices = runCatching {
                    describeUnresolvedSlots(fileName, allSlots, unresolvedIndices, roleProfiles.keys)
                }.getOrDefault(emptyList())
                if (choices.isNotEmpty()) {
                    matches = json.parseToJsonElement(
                        captureFillForm(
                            JsonArray(fieldInputs).toString(),
                            profilesJsonStr,
                            JsonArray(choices).toString(),
                            true,
                        ),
                    ).jsonArray
                }
            }

            val placementsByPage = pages
                .associate { it.index to mutableListOf<AndroidDocumentEngine.DrawPlacement>() }
                .toMutableMap()
            allSlots.forEachIndexed { idx, slot ->
                val valStr = matches.getOrNull(idx)?.jsonObject
                    ?.get("value")?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (valStr.isEmpty() || slot.rect.size < 4) return@forEachIndexed
                val pageNum = slot.id.split(':').getOrNull(1)?.toIntOrNull() ?: 0
                val action = when {
                    slot.id.endsWith(":circle") -> "circle"
                    slot.id.endsWith(":check") -> "check"
                    else -> "text"
                }
                val combCells = (Regex("comb:(\\d+)").find(slot.format) ?: Regex(":comb:(\\d+)").find(slot.id))
                    ?.groupValues?.getOrNull(1)?.toIntOrNull()
                val closedCell = slot.id.endsWith(":cell")
                placementsByPage[pageNum]?.add(
                    AndroidDocumentEngine.DrawPlacement(
                        page = pageNum,
                        left = slot.rect[0].toFloat(),
                        top = slot.rect[1].toFloat(),
                        width = slot.rect[2].toFloat(),
                        height = slot.rect[3].toFloat(),
                        value = valStr,
                        action = action,
                        comb = combCells,
                        closedCell = closedCell,
                    ),
                )
            }

            for ((pageIndex, snapped) in snappedByPage) {
                val pageList = placementsByPage.getOrPut(pageIndex) { mutableListOf() }

                if (snapped.size >= 5) {
                    // Retain crisp pixel-ruled `:comb:` character grids while letting 2D vision
                    // supersede plain 1D heuristic guesses that might hit prose lines or table cells.
                    pageList.retainAll { (it.comb ?: 0) >= 2 }
                }

                for (sf in snapped) {
                    if (sf.box.size != 4) continue
                    val sl = sf.box[0].toFloat()
                    val st = sf.box[1].toFloat()
                    val sw = sf.box[2].toFloat()
                    val sh = sf.box[3].toFloat()
                    val overlapsStructured = pageList.any { ex ->
                        (ex.comb ?: 0) >= 2 &&
                            overlapRatio(sl, st, sw, sh, ex.left, ex.top, ex.width, ex.height) >= 0.25f
                    }
                    if (overlapsStructured) continue
                    pageList.removeAll { ex ->
                        overlapRatio(sl, st, sw, sh, ex.left, ex.top, ex.width, ex.height) >= 0.25f
                    }
                    pageList += AndroidDocumentEngine.DrawPlacement(
                        page = pageIndex,
                        left = sl,
                        top = st,
                        width = sw,
                        height = sh,
                        value = if (sf.action == "check") "✓" else sf.value,
                        action = sf.action,
                        comb = sf.comb,
                        closedCell = sf.closed_cell,
                    )
                }
            }

            val finalPlacements = placementsByPage.values.flatten()
            val originalPreview = pages.firstOrNull()?.bitmap?.let { src ->
                val edge = max(src.width, src.height).coerceAtLeast(1)
                if (edge > 1600) {
                    val scale = 1600f / edge
                    Bitmap.createScaledBitmap(
                        src,
                        (src.width * scale).toInt().coerceAtLeast(1),
                        (src.height * scale).toInt().coerceAtLeast(1),
                        true,
                    )
                } else {
                    src.copy(Bitmap.Config.ARGB_8888, false)
                }
            }
            val (renderedBytes, previewBmp) = AndroidDocumentEngine.renderFilledPages(
                pages = pages,
                lumas = lumas,
                placements = finalPlacements,
                asPdf = isPdf,
            )
            val outExt = if (isPdf) "pdf" else "png"
            val outMime = if (isPdf) "application/pdf" else "image/png"
            FilledFormResult(
                bytes = renderedBytes,
                fileName = buildFilledFileName(fileName, outExt),
                mediaType = outMime,
                filledCount = finalPlacements.size,
                previewBitmap = previewBmp,
                originalPreviewBitmap = originalPreview,
            )
        } finally {
            pages.forEach { it.bitmap.recycle() }
        }
    }

    private suspend fun describeUnresolvedSlots(
        fileName: String,
        allSlots: List<AndroidDocumentEngine.DetectedSlot>,
        unresolvedIndices: List<Int>,
        availableRoles: Set<String>,
    ): List<JsonObject> = coroutineScope {
        val sectionIds = linkedMapOf("" to "main")
        val sections = mutableListOf(
            buildJsonObject {
                put("id", "main")
                put("label", fileName)
            },
        )
        for (idx in unresolvedIndices) {
            val sec = allSlots[idx].section.trim()
            if (sec.isNotEmpty() && sec !in sectionIds) {
                val sid = "sec_${sections.size}"
                sectionIds[sec] = sid
                sections += buildJsonObject {
                    put("id", sid)
                    put("label", sec)
                }
            }
        }
        val graphFields = unresolvedIndices.map { idx ->
            val s = allSlots[idx]
            buildJsonObject {
                put("id", "f_$idx")
                put("sectionId", sectionIds[s.section.trim()] ?: "main")
                put("label", s.label)
                put("type", s.input_type)
                put("options", JsonArray(s.options.take(50).map(::JsonPrimitive)))
            }
        }
        val chunks = graphFields.chunked(40)
        val askObjects = mutableListOf<JsonObject>()
        for (batch in chunks.chunked(3)) {
            val responses = batch.map { chunk ->
                async {
                    val usedIds = chunk.mapNotNull { it["sectionId"]?.jsonPrimitive?.contentOrNull }.toSet()
                    val filteredSecs = sections.filter { it["id"]?.jsonPrimitive?.contentOrNull in usedIds }
                    postWithAuth(
                        "https://decision.vowkey.app/v1/forms/describe",
                        buildJsonObject {
                            put("v", 1)
                            put("targetId", "file:$fileName:0")
                            put("formSignature", "android")
                            put("sections", JsonArray(filteredSecs))
                            put("fields", JsonArray(chunk))
                        },
                    )
                }
            }.awaitAll()
            responses.forEach { r ->
                r["fields"]?.jsonArray?.forEach { askObjects += it.jsonObject }
            }
        }
        askObjects.mapNotNull { ask ->
            val idx = ask["id"]?.jsonPrimitive?.contentOrNull?.removePrefix("f_")?.toIntOrNull()
                ?: return@mapNotNull null
            val slot = allSlots.getOrNull(idx) ?: return@mapNotNull null
            val owner = ask["owner"]?.jsonPrimitive?.contentOrNull ?: "applicant"
            val rawAttr = ask["attribute"]?.jsonPrimitive?.contentOrNull.orEmpty()
            val attr = when {
                owner == "official_only" || rawAttr == "none" || rawAttr == "unknown" -> ""
                owner != "applicant" &&
                    owner != "employer" &&
                    owner !in availableRoles &&
                    !owner.startsWith("household_member.") -> ""
                else -> rawAttr
            }
            buildJsonObject {
                put("id", slot.id)
                put("attribute", attr)
                put("owner", owner)
            }
        }
    }

    private fun buildRoleProfiles(
        primary: CipherView,
        allProfiles: List<CipherView>,
        cards: List<CipherView>,
    ): Pair<Map<String, Map<String, String>>, Map<String, String>> {
        val primaryFlat = LinkedHashMap(primary.profileFlatDetails())
        val firstAllowedCard = cards.firstOrNull {
            it.type == CipherType.CARD && it.deletedDate == null && it.itemAgentRule() != "never"
        }?.card
        if (firstAllowedCard != null) {
            firstAllowedCard.cardholderName?.takeIf { it.isNotBlank() }?.let { primaryFlat.putIfAbsent("card.holder", it) }
            firstAllowedCard.number?.takeIf { it.isNotBlank() }?.let { primaryFlat.putIfAbsent("card.number", it) }
            firstAllowedCard.expMonth?.takeIf { it.isNotBlank() }?.let { primaryFlat.putIfAbsent("card.expiry.month", it) }
            firstAllowedCard.expYear?.takeIf { it.isNotBlank() }?.let { primaryFlat.putIfAbsent("card.expiry.year", it) }
            firstAllowedCard.code?.takeIf { it.isNotBlank() }?.let { primaryFlat.putIfAbsent("card.cvv", it) }
            firstAllowedCard.brand?.takeIf { it.isNotBlank() }?.let { primaryFlat.putIfAbsent("card.brand", it) }
        }
        val expandedRaw = runCatching {
            json.parseToJsonElement(captureProfilesFromFlat(json.encodeToString(primaryFlat))).jsonObject
        }.getOrNull()
        val roles = linkedMapOf<String, MutableMap<String, String>>()
        expandedRaw?.forEach { (role, mapEl) ->
            val m = linkedMapOf<String, String>()
            mapEl.jsonObject.forEach { (k, v) ->
                v.jsonPrimitive.contentOrNull?.takeIf { it.isNotBlank() }?.let { m[k] = it }
            }
            if (m.isNotEmpty()) roles[role] = m
        }
        roles.getOrPut("applicant") { LinkedHashMap(primaryFlat) }

        var depIdx = if ("dependent" in roles) 2 else 1
        for (other in allProfiles) {
            if (other.id == primary.id) continue
            val flat = other.profileFlatDetails()
            if (flat.isEmpty()) continue
            val rel = other.profileEnvelope()?.get("relationship")?.jsonPrimitive?.contentOrNull?.lowercase().orEmpty()
            val roleKey = when {
                rel.contains("spouse") || rel.contains("wife") || rel.contains("husband") || "spouse" !in roles -> "spouse"
                depIdx == 1 -> "dependent".also { depIdx++ }
                else -> "dependent.${depIdx++}"
            }
            val target = roles.getOrPut(roleKey) { linkedMapOf() }
            flat.forEach { (k, v) ->
                target.putIfAbsent(k, v)
                primaryFlat.putIfAbsent("$roleKey.$k", v)
            }
        }
        return roles to primaryFlat
    }

    private fun attachLocalPieceLocators(
        details: Map<String, String>,
        locators: MutableMap<String, JsonElement>,
        pages: List<AndroidDocumentEngine.PageBitmap>,
    ) {
        if (pages.isEmpty()) return
        for ((key, rawValue) in details) {
            if (key in locators) continue
            val needle = rawValue.trim()
            if (needle.length < 2) continue
            val compactNeedle = needle.filterNot(Char::isWhitespace).lowercase()
            outer@ for (page in pages) {
                for (piece in page.pieces) {
                    val pieceText = piece.text.trim()
                    if (pieceText.isEmpty()) continue
                    val compactPiece = pieceText.filterNot(Char::isWhitespace).lowercase()
                    if (pieceText.contains(needle, ignoreCase = true) ||
                        (compactNeedle.length >= 4 && compactPiece.contains(compactNeedle))
                    ) {
                        locators[key] = buildJsonObject {
                            put("page", page.index)
                            put("x", piece.left)
                            put("y", piece.top)
                            put("w", piece.width)
                            put("h", piece.height)
                        }
                        break@outer
                    }
                }
            }
        }
    }

    private fun overlapRatio(
        ax: Float,
        ay: Float,
        aw: Float,
        ah: Float,
        bx: Float,
        by: Float,
        bw: Float,
        bh: Float,
    ): Float {
        val ix = max(0f, min(ax + aw, bx + bw) - max(ax, bx))
        val iy = max(0f, min(ay + ah, by + bh) - max(ay, by))
        val inter = ix * iy
        if (inter <= 0f) return 0f
        val minArea = max(1e-6f, min(aw * ah, bw * bh))
        return inter / minArea
    }

    private fun buildFilledFileName(sourceName: String, defaultExt: String): String {
        val base = sourceName.substringBeforeLast('.').ifBlank { "form" }
        return "$base-filled.$defaultExt"
    }

    private fun answers(requests: String): String = JsonArray(json.parseToJsonElement(requests).jsonArray.map { request ->
        val allowed = request.jsonObject.filterKeys { it == "state" || it == "questions" || it == "model" }
        check(allowed["state"] is JsonObject && allowed["questions"] is JsonObject) {
            "Couldn't prepare this request. Try again."
        }
        postWithAuth("https://decision.vowkey.app/v1/systemone", JsonObject(allowed))
    }).toString()

    private fun guestAuthorization(forceRefresh: Boolean = false): String {
        if (forceRefresh || guestToken == null || System.currentTimeMillis() >= expiresAt) {
            val grant = post(
                "${environment.environment.baseIdentityUrl.trimEnd('/')}/guest-decision/grant",
                null,
                buildJsonObject { put("installationId", store.installationId) },
            ).second
            val nextToken = grant["token"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() }
                ?: error("Vowkey's cloud service isn't responding right now. Try again in a moment.")
            val seconds = grant["expiresIn"]?.jsonPrimitive?.longOrNull?.takeIf { it > 0L }
                ?: error("Vowkey's cloud service isn't responding right now. Try again in a moment.")
            guestToken = nextToken
            expiresAt = System.currentTimeMillis() + seconds * 1000 - 30_000
        }
        return guestToken ?: error("Vowkey's cloud service isn't responding right now. Try again in a moment.")
    }

    private fun postWithAuth(url: String, body: JsonObject): JsonObject {
        check(!onDeviceOnly) { "On-device only mode is active." }
        val activeUser = auth.userState?.activeUserId
        val accountToken = activeUser?.let { auth.getAccountTokens(it)?.accessToken }
        if (!accountToken.isNullOrBlank()) {
            val (code, resp) = post(url, accountToken, body, allowAuthFailure = true)
            if (code in 200..299) return resp
            if (code == 401 || code == 403) {
                return post(url, guestAuthorization(), body).second
            }
            error("Vowkey's cloud service isn't responding right now. Try again in a moment.")
        }
        val (code, resp) = post(url, guestAuthorization(), body, allowAuthFailure = true)
        if (code == 401 || code == 403) {
            return post(url, guestAuthorization(forceRefresh = true), body).second
        }
        check(code in 200..299) { "Vowkey's cloud service isn't responding right now. Try again in a moment." }
        return resp
    }

    private fun post(
        url: String,
        token: String?,
        body: JsonObject,
        allowAuthFailure: Boolean = false,
    ): Pair<Int, JsonObject> {
        val connection = try {
            (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"; doOutput = true; connectTimeout = 30_000; readTimeout = 90_000
                setRequestProperty("Content-Type", "application/json")
                token?.let { setRequestProperty("Authorization", "Bearer $it") }
            }
        } catch (_: IOException) {
            error("Couldn't reach Vowkey. Check your connection and try again, or turn on On-device only in Settings.")
        }
        return try {
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = connection.responseCode
            if (code !in 200..299) {
                if (allowAuthFailure && (code == 401 || code == 403)) {
                    return code to buildJsonObject {}
                }
                error("Vowkey's cloud service isn't responding right now. Try again in a moment.")
            }
            val parsed = connection.inputStream.bufferedReader().use {
                runCatching { json.parseToJsonElement(it.readText()).jsonObject }
                    .getOrElse { error("Vowkey returned an unreadable response. Try again.") }
            }
            code to parsed
        } catch (_: IOException) {
            error("Couldn't reach Vowkey. Check your connection and try again, or turn on On-device only in Settings.")
        } finally { connection.disconnect() }
    }
}
