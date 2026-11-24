package com.vowkey.app.data.vault.datasource.disk

import android.graphics.Bitmap
import kotlinx.serialization.Serializable

@Serializable
data class OcrPiece(
    val text: String,
    val left: Double,
    val top: Double,
    val width: Double,
    val height: Double,
    val confidence: Double = 1.0,
)

interface DocumentOcrEngine {
    suspend fun recognize(bitmap: Bitmap): List<OcrPiece>
}
