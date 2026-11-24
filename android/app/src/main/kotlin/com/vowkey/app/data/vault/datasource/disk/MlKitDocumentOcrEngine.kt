@file:OmitFromCoverage
@file:Suppress("MagicNumber", "LongMethod", "CyclomaticComplexMethod", "TooGenericExceptionCaught")

package com.vowkey.app.data.vault.datasource.disk

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions
import com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.vowkey.annotation.OmitFromCoverage
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlin.math.max
import kotlin.math.min
import kotlinx.coroutines.suspendCancellableCoroutine

@OmitFromCoverage
class MlKitDocumentOcrEngine : DocumentOcrEngine {
    private val latinRecognizer: TextRecognizer by lazy {
        TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
    }
    private val japaneseRecognizer: TextRecognizer by lazy {
        TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
    }
    private val chineseRecognizer: TextRecognizer by lazy {
        TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
    }
    private val koreanRecognizer: TextRecognizer by lazy {
        TextRecognition.getClient(KoreanTextRecognizerOptions.Builder().build())
    }

    override suspend fun recognize(bitmap: Bitmap): List<OcrPiece> {
        val w = bitmap.width.coerceAtLeast(1).toDouble()
        val h = bitmap.height.coerceAtLeast(1).toDouble()
        val input = InputImage.fromBitmap(bitmap, 0)
        val recognizers = listOf(
            latinRecognizer,
            japaneseRecognizer,
            chineseRecognizer,
            koreanRecognizer,
        )
        var bestScore = -1.0
        var bestPieces: List<OcrPiece> = emptyList()
        var mrzCandidates: List<OcrPiece> = emptyList()

        for ((passIdx, recognizer) in recognizers.withIndex()) {
            val result = try {
                recognizer.process(input).awaitTask()
            } catch (_: Throwable) {
                continue
            }
            val pieces = extractPieces(result, w, h)
            if (passIdx == 0) {
                mrzCandidates = pieces.filter { isMrzCandidate(it.text) }
            }
            val score = scorePass(pieces)
            if (score > bestScore) {
                bestScore = score
                bestPieces = pieces
            }
        }
        if (mrzCandidates.isNotEmpty()) {
            val filtered = bestPieces.filterNot { existing ->
                mrzCandidates.any { mrz -> overlapsRow(existing, mrz) }
            }
            return (filtered + mrzCandidates).sortedWith(compareBy<OcrPiece> { it.top }.thenBy { it.left })
        }
        return bestPieces.sortedWith(compareBy<OcrPiece> { it.top }.thenBy { it.left })
    }

    private fun extractPieces(result: Text, imgW: Double, imgH: Double): List<OcrPiece> {
        val out = mutableListOf<OcrPiece>()
        for (block in result.textBlocks) {
            for (line in block.lines) {
                val lineBox = line.boundingBox ?: continue
                val elems = line.elements.filter { it.boundingBox != null && it.text.isNotBlank() }
                if (elems.size <= 1) {
                    val trimmed = line.text.trim()
                    if (trimmed.isNotEmpty()) {
                        out += rectToPiece(trimmed, lineBox, imgW, imgH, line.confidence.toDouble())
                    }
                    continue
                }
                var startIdx = 0
                for (k in 1 until elems.size) {
                    val prevB = checkNotNull(elems[k - 1].boundingBox)
                    val currB = checkNotNull(elems[k].boundingBox)
                    val gap = (currB.left - prevB.right).coerceAtLeast(0)
                    val lineH = max(prevB.height(), currB.height()).coerceAtLeast(1)
                    if (gap > lineH * 0.78) {
                        out += mergeElements(elems.subList(startIdx, k), imgW, imgH)
                        startIdx = k
                    }
                }
                out += mergeElements(elems.subList(startIdx, elems.size), imgW, imgH)
            }
        }
        return out
    }

    private fun mergeElements(
        elements: List<Text.Element>,
        imgW: Double,
        imgH: Double,
    ): OcrPiece {
        var left = Int.MAX_VALUE
        var top = Int.MAX_VALUE
        var right = Int.MIN_VALUE
        var bottom = Int.MIN_VALUE
        var confSum = 0.0
        val sb = StringBuilder()
        for ((i, el) in elements.withIndex()) {
            val b = checkNotNull(el.boundingBox)
            left = min(left, b.left)
            top = min(top, b.top)
            right = max(right, b.right)
            bottom = max(bottom, b.bottom)
            confSum += el.confidence.toDouble()
            if (i > 0) {
                val prevLast = sb.lastOrNull()
                val nextFirst = el.text.firstOrNull()
                if (prevLast != null && nextFirst != null && !(isCjk(prevLast) && isCjk(nextFirst))) {
                    sb.append(' ')
                }
            }
            sb.append(el.text.trim())
        }
        val avgConf = (confSum / elements.size.coerceAtLeast(1)).coerceIn(0.0, 1.0)
        return rectToPiece(sb.toString(), Rect(left, top, right, bottom), imgW, imgH, avgConf)
    }

    private fun rectToPiece(
        text: String,
        rect: Rect,
        imgW: Double,
        imgH: Double,
        conf: Double,
    ): OcrPiece {
        val l = (rect.left / imgW).coerceIn(0.0, 1.0)
        val t = (rect.top / imgH).coerceIn(0.0, 1.0)
        val w = ((rect.right - rect.left) / imgW).coerceIn(0.001, 1.0 - l)
        val h = ((rect.bottom - rect.top) / imgH).coerceIn(0.001, 1.0 - t)
        return OcrPiece(
            text = text,
            left = l,
            top = t,
            width = w,
            height = h,
            confidence = if (conf > 0.0) conf else 0.9,
        )
    }

    private fun scorePass(pieces: List<OcrPiece>): Double {
        var cjkCount = 0
        var totalAlphaNum = 0
        for (p in pieces) {
            for (ch in p.text) {
                if (ch.isLetterOrDigit()) {
                    totalAlphaNum++
                    if (isCjk(ch)) cjkCount++
                }
            }
        }
        val substantialCjk = cjkCount >= 6 && cjkCount.toDouble() / totalAlphaNum.coerceAtLeast(1) >= 0.05
        var score = 0.0
        for (p in pieces) {
            val noise = p.text.count { it in "#*÷•=+][" }
            var weight = 0.0
            for (ch in p.text) {
                if (!ch.isLetterOrDigit()) continue
                weight += if (isCjk(ch)) {
                    if (substantialCjk) 3.2 else 0.5
                } else {
                    1.0
                }
            }
            score += p.confidence * (weight - noise * 4.0).coerceAtLeast(0.0)
        }
        return score
    }

    private fun isCjk(ch: Char): Boolean {
        val code = ch.code
        return code in 0x3040..0x30FF || code in 0x3400..0x9FFF || code in 0xAC00..0xD7AF
    }

    private fun isMrzCandidate(raw: String): Boolean {
        val compact = raw.filterNot { it.isWhitespace() }
        if (compact.length < 24 || compact.any { it.isLowerCase() }) return false
        val valid = compact.count { it in 'A'..'Z' || it in '0'..'9' || it == '<' }
        return valid.toDouble() / compact.length >= 0.88 && compact.contains('<')
    }

    private fun overlapsRow(a: OcrPiece, b: OcrPiece): Boolean {
        val midDiff = kotlin.math.abs((a.top + a.height * 0.5) - (b.top + b.height * 0.5))
        return midDiff <= max(a.height, b.height) * 0.85
    }
}

private suspend fun <T> Task<T>.awaitTask(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { result ->
        if (cont.isActive) cont.resume(result)
    }
    addOnFailureListener { err ->
        if (cont.isActive) cont.resumeWithException(err)
    }
    addOnCanceledListener {
        cont.cancel()
    }
}
