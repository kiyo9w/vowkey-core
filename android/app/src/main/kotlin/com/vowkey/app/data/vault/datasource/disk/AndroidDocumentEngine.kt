@file:OmitFromCoverage
@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod", "TooGenericExceptionCaught")

package com.vowkey.app.data.vault.datasource.disk

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.os.ParcelFileDescriptor
import android.util.Base64
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.sdk.captureDetectFormLayout
import com.vowkey.sdk.captureSnapImageFill
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

@OmitFromCoverage
internal object AndroidDocumentEngine {
    private val engineJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    data class PageBitmap(
        val index: Int,
        val bitmap: Bitmap,
        val pieces: List<OcrPiece>,
    ) {
        val aspect: Double
            get() = bitmap.width.coerceAtLeast(1).toDouble() / bitmap.height.coerceAtLeast(1).toDouble()
    }

    data class LumaGrid(
        val width: Int,
        val height: Int,
        val bytes: ByteArray,
    ) {
        fun lum(xNorm: Float, yNorm: Float): Int {
            val px = (xNorm * (width - 1)).roundToInt().coerceIn(0, width - 1)
            val py = (yNorm * (height - 1)).roundToInt().coerceIn(0, height - 1)
            return bytes[py * width + px].toInt() and 0xFF
        }

        /**
         * Returns the first normalized X coordinate where dark printed glyphs appear in `[yTop, yBottom]`
         * (excluding the bottom 30% dotted leader/underline band).
         */
        fun firstPrintedInkX(startX: Float, endX: Float, yTop: Float, yBottom: Float): Float? {
            if (endX <= startX + 0.004f || yBottom <= yTop + 0.003f) return null
            val x0 = (startX * width).toInt().coerceIn(1, width - 2)
            val x1 = (endX * width).toInt().coerceIn(1, width - 2)
            if (x1 <= x0) return null
            val midY = (yTop + yBottom) * 0.5f
            val samples = 6
            for (px in x0..x1) {
                val xNorm = px.toFloat() / width
                val bg = max(lum((xNorm - 0.012f).coerceAtLeast(0f), midY), lum((xNorm + 0.012f).coerceAtMost(1f), midY))
                var darkHits = 0
                for (s in 0 until samples) {
                    val y = yTop + (yBottom - yTop) * s / (samples - 1)
                    if (lum(xNorm, y) < bg - 28) darkHits++
                }
                if (darkHits >= 2) return xNorm
            }
            return null
        }
    }

    @Serializable
    data class DetectedSlot(
        val id: String,
        val label: String = "",
        val section: String = "",
        val input_type: String = "text",
        val format: String = "",
        val max_length: Int = 0,
        val options: List<String> = emptyList(),
        val rect: List<Double> = emptyList(),
    )

    @Serializable
    data class PlannedFill(
        val key: String = "",
        val value: String,
        val action: String = "text",
        val box: List<Double>,
        val comb: Int? = null,
        val label: String = "",
    )

    @Serializable
    data class SnappedFill(
        val key: String = "",
        val value: String,
        val action: String = "text",
        val box: List<Double>,
        val target: String = "",
        val comb: Int? = null,
        val closed_cell: Boolean = false,
        val label: String = "",
    )

    data class DrawPlacement(
        val page: Int,
        val left: Float,
        val top: Float,
        val width: Float,
        val height: Float,
        val value: String,
        val action: String = "text",
        val comb: Int? = null,
        val closedCell: Boolean = false,
    )

    fun isOfficeFileName(fileName: String): Boolean {
        val lower = fileName.lowercase()
        return lower.endsWith(".docx") || lower.endsWith(".xlsx") || lower.endsWith(".hwpx")
    }

    fun isPdf(bytes: ByteArray, fileName: String, mediaType: String): Boolean {
        if (fileName.lowercase().endsWith(".pdf") || mediaType.lowercase().contains("pdf")) return true
        return bytes.size >= 5 &&
            bytes[0] == '%'.code.toByte() &&
            bytes[1] == 'P'.code.toByte() &&
            bytes[2] == 'D'.code.toByte() &&
            bytes[3] == 'F'.code.toByte()
    }

    suspend fun decodePages(
        bytes: ByteArray,
        fileName: String,
        mediaType: String,
        cacheDir: File,
        ocr: DocumentOcrEngine,
        maxPages: Int = 8,
    ): List<PageBitmap> {
        return if (isPdf(bytes, fileName, mediaType)) {
            val tmp = File.createTempFile("vk_pdf_", ".pdf", cacheDir)
            try {
                tmp.writeBytes(bytes)
                val pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY)
                pfd.use { descriptor ->
                    PdfRenderer(descriptor).use { renderer ->
                        val count = min(renderer.pageCount, maxPages)
                        buildList {
                            for (i in 0 until count) {
                                renderer.openPage(i).use { page ->
                                    val maxEdge = max(page.width, page.height).coerceAtLeast(1)
                                    val scale = 2000f / maxEdge
                                    val bmpW = (page.width * scale).roundToInt().coerceAtLeast(1)
                                    val bmpH = (page.height * scale).roundToInt().coerceAtLeast(1)
                                    val bmp = Bitmap.createBitmap(bmpW, bmpH, Bitmap.Config.ARGB_8888)
                                    bmp.eraseColor(Color.WHITE)
                                    page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                                    val pieces = ocr.recognize(bmp)
                                    add(PageBitmap(i, bmp, pieces))
                                }
                            }
                        }
                    }
                }
            } finally {
                tmp.delete()
            }
        } else {
            val bmp = decodeOrientedBitmap(bytes, maxDimension = 2200)
                ?: error("Couldn't read this image.")
            val pieces = ocr.recognize(bmp)
            listOf(PageBitmap(0, bmp, pieces))
        }
    }

    fun decodeOrientedBitmap(bytes: ByteArray, maxDimension: Int = 2200): Bitmap? {
        val boundsOpts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, boundsOpts)
        if (boundsOpts.outWidth <= 0 || boundsOpts.outHeight <= 0) return null
        var sample = 1
        while (max(boundsOpts.outWidth / sample, boundsOpts.outHeight / sample) > maxDimension * 2) {
            sample *= 2
        }
        val decodeOpts = BitmapFactory.Options().apply {
            inSampleSize = sample
            inPreferredConfig = Bitmap.Config.ARGB_8888
        }
        val raw = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOpts) ?: return null
        val exifOrientation = runCatching {
            ExifInterface(ByteArrayInputStream(bytes))
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        }.getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val matrix = Matrix()
        when (exifOrientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.postRotate(90f)
                matrix.preScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.postRotate(270f)
                matrix.preScale(-1f, 1f)
            }
        }
        val maxRawEdge = max(raw.width, raw.height).coerceAtLeast(1)
        if (maxRawEdge > maxDimension) {
            val s = maxDimension.toFloat() / maxRawEdge
            matrix.postScale(s, s)
        }
        return if (matrix.isIdentity) {
            raw
        } else {
            val transformed = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
            if (transformed !== raw) raw.recycle()
            transformed
        }
    }

    fun extractLuma(bitmap: Bitmap, maxEdge: Int = 1600): LumaGrid {
        val edge = max(bitmap.width, bitmap.height).coerceAtLeast(1)
        val working = if (edge > maxEdge) {
            val scale = maxEdge.toFloat() / edge
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * scale).roundToInt().coerceAtLeast(1),
                (bitmap.height * scale).roundToInt().coerceAtLeast(1),
                true,
            )
        } else {
            bitmap
        }
        val w = working.width
        val h = working.height
        val argb = IntArray(w * h)
        working.getPixels(argb, 0, w, 0, 0, w, h)
        if (working !== bitmap) working.recycle()
        val luma = ByteArray(w * h)
        for (i in argb.indices) {
            val c = argb[i]
            val r = (c shr 16) and 0xFF
            val g = (c shr 8) and 0xFF
            val b = c and 0xFF
            luma[i] = ((r * 77 + g * 150 + b * 29) shr 8).toByte()
        }
        return LumaGrid(w, h, luma)
    }

    fun bitmapToJpegDataUrl(bitmap: Bitmap, maxEdge: Int = 1800, quality: Int = 88): String {
        val edge = max(bitmap.width, bitmap.height).coerceAtLeast(1)
        val scaled = if (edge > maxEdge) {
            val s = maxEdge.toFloat() / edge
            Bitmap.createScaledBitmap(
                bitmap,
                (bitmap.width * s).roundToInt().coerceAtLeast(1),
                (bitmap.height * s).roundToInt().coerceAtLeast(1),
                true,
            )
        } else {
            bitmap
        }
        val out = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, out)
        if (scaled !== bitmap) scaled.recycle()
        val b64 = Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        return "data:image/jpeg;base64,$b64"
    }

    fun detectFormSlots(page: PageBitmap, luma: LumaGrid): List<DetectedSlot> {
        val piecesJson = engineJson.encodeToString(page.pieces)
        val raw = captureDetectFormLayout(
            luma.bytes,
            luma.width.toUInt(),
            luma.height.toUInt(),
            piecesJson,
            page.index.toUInt(),
        )
        return engineJson.decodeFromString(raw)
    }

    fun snapPlannedFills(
        page: PageBitmap,
        luma: LumaGrid,
        planned: List<PlannedFill>,
    ): List<SnappedFill> {
        if (planned.isEmpty()) return emptyList()
        val piecesJson = engineJson.encodeToString(page.pieces)
        val plannedJson = engineJson.encodeToString(planned)
        val raw = captureSnapImageFill(
            luma.bytes,
            luma.width.toUInt(),
            luma.height.toUInt(),
            piecesJson,
            plannedJson,
            page.index.toUInt(),
        )
        return engineJson.decodeFromString(raw)
    }

    fun renderFilledPages(
        pages: List<PageBitmap>,
        lumas: List<LumaGrid>,
        placements: List<DrawPlacement>,
        asPdf: Boolean,
    ): Pair<ByteArray, Bitmap?> {
        val renderedBitmaps = pages.mapIndexed { idx, page ->
            val mutable = page.bitmap.copy(Bitmap.Config.ARGB_8888, true)
            val canvas = Canvas(mutable)
            val pageLuma = lumas.getOrNull(idx)
            val pagePlacements = placements.filter { it.page == page.index && it.value.isNotBlank() }
            for (p in pagePlacements) {
                drawPlacementOnCanvas(canvas, mutable.width.toFloat(), mutable.height.toFloat(), p, pageLuma)
            }
            mutable
        }
        val firstPreview = renderedBitmaps.firstOrNull()
        val encoded = if (asPdf) {
            val pdfDoc = PdfDocument()
            try {
                renderedBitmaps.forEachIndexed { idx, bmp ->
                    val pageInfo = PdfDocument.PageInfo.Builder(bmp.width, bmp.height, idx + 1).create()
                    val pdfPage = pdfDoc.startPage(pageInfo)
                    pdfPage.canvas.drawBitmap(bmp, 0f, 0f, null)
                    pdfDoc.finishPage(pdfPage)
                }
                ByteArrayOutputStream().also { pdfDoc.writeTo(it) }.toByteArray()
            } finally {
                pdfDoc.close()
            }
        } else {
            val out = ByteArrayOutputStream()
            firstPreview?.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
        renderedBitmaps.drop(1).forEach { it.recycle() }
        return encoded to firstPreview
    }

    private fun drawPlacementOnCanvas(
        canvas: Canvas,
        imgW: Float,
        imgH: Float,
        p: DrawPlacement,
        luma: LumaGrid?,
    ) {
        val inkColor = Color.argb(245, 10, 38, 107)
        val box = RectF(
            p.left * imgW,
            p.top * imgH,
            (p.left + p.width) * imgW,
            (p.top + p.height) * imgH,
        )
        if (box.width() < 2f || box.height() < 2f) return

        when (p.action) {
            "circle" -> {
                val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
                    color = inkColor
                    style = Paint.Style.STROKE
                    strokeWidth = (box.height() * 0.10f).coerceIn(2.2f, 4.2f)
                }
                val oval = RectF(box.left - 3f, box.top - 2f, box.right + 3f, box.bottom + 2f)
                canvas.drawOval(oval, strokePaint)
                return
            }
            "check" -> {
                val norm = p.value.trim().lowercase()
                if (norm in setOf("false", "0", "off", "no", "none")) return
                val checkSize = (box.height() * 0.82f).coerceIn(14f, 30f)
                drawFittedText(
                    canvas = canvas,
                    text = "✓",
                    box = box,
                    maxFontSize = checkSize,
                    minFontSize = 10f,
                    padX = 1f,
                    centerH = true,
                    centerV = true,
                    inkColor = inkColor,
                )
                return
            }
        }

        val combCells = p.comb ?: 0
        if (combCells >= 2) {
            val chars = combCharacters(p.value.trim(), combCells)
            val cellW = box.width() / combCells
            val maxFont = min(min((box.height() * 0.62f).coerceAtLeast(13f), cellW * 0.78f), 28f)
            chars.take(combCells).forEachIndexed { idx, ch ->
                val cellBox = RectF(
                    box.left + idx * cellW,
                    box.top,
                    box.left + (idx + 1) * cellW,
                    box.bottom,
                )
                drawFittedText(
                    canvas = canvas,
                    text = ch.toString(),
                    box = cellBox,
                    maxFontSize = maxFont,
                    minFontSize = 9f,
                    padX = 1f,
                    centerH = true,
                    centerV = true,
                    inkColor = inkColor,
                )
            }
            return
        }

        val trimmed = p.value.trim()
        val charCount = trimmed.length.coerceAtLeast(1).toFloat()
        val naturalBody = (imgH * 0.0126f).coerceIn(13f, 28f)
        val maxFontByHeight = if (p.closedCell) {
            (box.height() * 0.64f).coerceIn(12.5f, 28f)
        } else {
            max(naturalBody, (box.height() * 0.72f).coerceAtMost(30f))
        }

        val drawBox = RectF(box)
        if (!p.closedCell && luma != null) {
            val upperTop = p.top + p.height * 0.08f
            val upperBot = p.top + p.height * 0.62f
            val nearInkX = luma.firstPrintedInkX(
                startX = p.left + 0.022f,
                endX = min(0.97f, p.left + p.width + 0.008f),
                yTop = upperTop,
                yBottom = upperBot,
            )
            if (nearInkX != null) {
                val safeMaxX = nearInkX * imgW - 6f
                if (safeMaxX > drawBox.left + 20f && safeMaxX < drawBox.right) {
                    drawBox.right = safeMaxX
                }
            }
            val desiredW = maxFontByHeight * charCount * 0.60f + 8f
            if (desiredW > drawBox.width()) {
                var rightLimit = imgW * 0.94f
                val probeEnd = min(0.96f, p.left + (desiredW / imgW) + 0.03f)
                val printedX = luma.firstPrintedInkX(
                    startX = p.left + 0.022f,
                    endX = probeEnd,
                    yTop = upperTop,
                    yBottom = upperBot,
                )
                if (printedX != null) {
                    rightLimit = min(rightLimit, printedX * imgW - 6f)
                }
                if (rightLimit > drawBox.right) {
                    drawBox.right = drawBox.left + min(desiredW, rightLimit - drawBox.left)
                }
            }
        }

        val maxFontByWidth = max(8.5f, (drawBox.width() * 0.94f) / max(charCount * 0.60f, 1f))
        val fontSize = min(maxFontByHeight, maxFontByWidth)
        val minFont = if (p.closedCell) 8.5f else 9.0f
        drawFittedText(
            canvas = canvas,
            text = trimmed,
            box = drawBox,
            maxFontSize = fontSize,
            minFontSize = min(minFont, fontSize),
            padX = if (p.closedCell) 4f else 3f,
            centerH = false,
            centerV = p.closedCell,
            inkColor = inkColor,
        )
    }

    private fun drawFittedText(
        canvas: Canvas,
        text: String,
        box: RectF,
        maxFontSize: Float,
        minFontSize: Float,
        padX: Float,
        centerH: Boolean,
        centerV: Boolean,
        inkColor: Int,
    ) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            color = inkColor
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
            textSize = maxFontSize
        }
        val availW = max(8f, box.width() - padX * 2f)
        var measuredW = paint.measureText(text)
        if (measuredW > availW && measuredW > 0f) {
            paint.textSize = max(minFontSize, maxFontSize * (availW / measuredW))
            measuredW = paint.measureText(text)
        }
        val fm = paint.fontMetrics
        val drawX = if (centerH) {
            box.left + max(1f, (box.width() - measuredW) * 0.5f)
        } else {
            box.left + padX
        }
        val baselineY = if (centerV) {
            box.centerY() - (fm.ascent + fm.descent) * 0.5f
        } else {
            box.bottom - (box.height() * 0.30f).coerceIn(5.5f, 15f)
        }
        canvas.drawText(text, drawX, baselineY, paint)
    }

    private fun combCharacters(value: String, cells: Int): List<Char> {
        val noSpaces = value.filterNot { it.isWhitespace() }.toList()
        if (noSpaces.size <= cells) return noSpaces
        val alnum = noSpaces.filter { it.isLetterOrDigit() }
        return if (alnum.isNotEmpty() && alnum.size <= cells) alnum else noSpaces
    }
}
