package com.vowkey.app.ui.vowkey

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vowkey.app.data.vault.datasource.disk.humanDetailLabel
import com.vowkey.app.data.vault.datasource.disk.newNativeCipher
import com.vowkey.app.data.vault.datasource.disk.withProfileEnvelope
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.vault.AttachmentView
import com.vowkey.vault.CipherType
import com.vowkey.vault.CipherView
import com.vowkey.vault.FieldType
import com.vowkey.vault.FieldView
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.util.UUID
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

data class VowkeySampleField(
    val key: String,
    val cardLabel: String,
    val printedValue: String,
    val practiceFormLabel: String,
    val practiceFillValue: String,
    val primaryScript: String? = null,
    val alternateValue: String? = null,
    val alternateScript: String? = null,
)

data class VowkeySampleScenario(
    val id: String,
    val chipTitle: String,
    val profileName: String,
    val documentKind: String,
    val fileName: String,
    val issuerHeader: String,
    val cardSubtitle: String,
    val bannerColorArgb: Int,
    val expiresOn: String,
    val documentDate: String,
    val footerLine1: String,
    val footerLine2: String,
    val practiceFormTitle: String,
    val practiceFormSubtitle: String,
    val humanOnlyPrompt: String,
    val fields: List<VowkeySampleField>,
)

object VowkeySampleWalkthrough {
    const val SAMPLE_ATTACHMENT_PREFIX = "sample-doc-"
    private const val CARD_W = 960f
    private const val CARD_H = 640f

    val scenarios: List<VowkeySampleScenario> = listOf(
        VowkeySampleScenario(
            id = "passport",
            chipTitle = "Passport",
            profileName = "Åsamund Østenbyen (Sample)",
            documentKind = "Passport",
            fileName = "norway-passport-sample.png",
            issuerHeader = "KONGERIKET NORGE · KINGDOM OF NORWAY",
            cardSubtitle = "PASS · PASSPORT · PASSEPORT",
            bannerColorArgb = 0xFF8B1D2C.toInt(),
            expiresOn = "2032-08-14",
            documentDate = "2022-08-14",
            footerLine1 = "P<NOROSTENBYEN<<ASAMUND<<<<<<<<<<<<<<<<<<<<<",
            footerLine2 = "CCC0194823NOR8804193M3208145<<<<<<<<<<<<<<04",
            practiceFormTitle = "Airline international check-in",
            practiceFormSubtitle = "Practice filling travel details from a sample Norwegian passport.",
            humanOnlyPrompt = "Seat preference (human choice — Vowkey leaves this for you)",
            fields = listOf(
                VowkeySampleField(
                    key = "name.full",
                    cardLabel = "SURNAME / GIVEN NAMES",
                    printedValue = "Åsamund Østenbyen",
                    practiceFormLabel = "Passenger full name (MRZ / ASCII)",
                    practiceFillValue = "ASAMUND OSTENBYEN",
                    primaryScript = "Latn",
                    alternateValue = "ASAMUND OSTENBYEN",
                    alternateScript = "ASCII",
                ),
                VowkeySampleField(
                    key = "id.passport.number",
                    cardLabel = "PASSPORT NO.",
                    printedValue = "CCC019482",
                    practiceFormLabel = "Passport number",
                    practiceFillValue = "CCC019482",
                ),
                VowkeySampleField(
                    key = "person.nationality",
                    cardLabel = "NATIONALITY",
                    printedValue = "Norwegian",
                    practiceFormLabel = "Nationality",
                    practiceFillValue = "Norwegian",
                ),
                VowkeySampleField(
                    key = "birth.date",
                    cardLabel = "DATE OF BIRTH",
                    printedValue = "1988-04-19",
                    practiceFormLabel = "Date of birth",
                    practiceFillValue = "1988-04-19",
                ),
                VowkeySampleField(
                    key = "id.passport.expiry",
                    cardLabel = "DATE OF EXPIRY",
                    printedValue = "2032-08-14",
                    practiceFormLabel = "Passport expiry date",
                    practiceFillValue = "2032-08-14",
                ),
                VowkeySampleField(
                    key = "birth.place",
                    cardLabel = "PLACE OF BIRTH",
                    printedValue = "Tromsø",
                    practiceFormLabel = "Place of birth",
                    practiceFillValue = "Tromsø",
                ),
            ),
        ),
        VowkeySampleScenario(
            id = "idcard",
            chipTitle = "National ID",
            profileName = "Erika Mustermann (Sample)",
            documentKind = "National ID card",
            fileName = "germany-personalausweis-sample.png",
            issuerHeader = "BUNDESREPUBLIK DEUTSCHLAND",
            cardSubtitle = "PERSONALAUSWEIS · IDENTITY CARD",
            bannerColorArgb = 0xFF1E3A5F.toInt(),
            expiresOn = "2031-10-31",
            documentDate = "2021-11-01",
            footerLine1 = "IDD<<T220001293<<<<<<<<<<<<<<<",
            footerLine2 = "8308126F3110315D<<<<<<<<<<<<<6",
            practiceFormTitle = "Apartment lease registration",
            practiceFormSubtitle = "Practice filling municipal registration details from a sample German ID card.",
            humanOnlyPrompt = "Move-in inspection notes (left blank for you)",
            fields = listOf(
                VowkeySampleField(
                    key = "name.full",
                    cardLabel = "NAME / VORNAME",
                    printedValue = "Erika Mustermann",
                    practiceFormLabel = "Full legal name",
                    practiceFillValue = "Erika Mustermann",
                ),
                VowkeySampleField(
                    key = "id.national.number",
                    cardLabel = "AUSWEISNUMMER",
                    printedValue = "T22000129",
                    practiceFormLabel = "National ID number",
                    practiceFillValue = "T22000129",
                ),
                VowkeySampleField(
                    key = "birth.date",
                    cardLabel = "GEBURTSTAG",
                    printedValue = "1983-08-12",
                    practiceFormLabel = "Date of birth",
                    practiceFillValue = "1983-08-12",
                ),
                VowkeySampleField(
                    key = "person.nationality",
                    cardLabel = "STAATSANGEHÖRIGKEIT",
                    printedValue = "Deutsch",
                    practiceFormLabel = "Citizenship",
                    practiceFillValue = "Deutsch",
                ),
                VowkeySampleField(
                    key = "address.full",
                    cardLabel = "ANSCHRIFT",
                    printedValue = "Heidestraße 17, 51147 Köln",
                    practiceFormLabel = "Registered address",
                    practiceFillValue = "Heidestraße 17, 51147 Köln",
                ),
                VowkeySampleField(
                    key = "id.card.expiry",
                    cardLabel = "GÜLTIG BIS",
                    printedValue = "2031-10-31",
                    practiceFormLabel = "Card valid until",
                    practiceFillValue = "2031-10-31",
                ),
            ),
        ),
        VowkeySampleScenario(
            id = "residence",
            chipTitle = "Residence",
            profileName = "Nguyễn Thị Linh (Sample)",
            documentKind = "Residence card",
            fileName = "multi-script-residence-sample.png",
            issuerHeader = "RESIDENCE CARD · PERMIT OF STAY",
            cardSubtitle = "MULTI-SCRIPT IDENTITY SPECIMEN",
            bannerColorArgb = 0xFF1B5E4A.toInt(),
            expiresOn = "2028-05-20",
            documentDate = "2025-05-20",
            footerLine1 = "RC<<AB12345678<<NGUYEN<THI<LINH<<<<<<<<<<<<<",
            footerLine2 = "9411032F2805209VNM<<<<<<<<<<<<<<<<<<<<<<<<08",
            practiceFormTitle = "Multi-script bank & municipality form",
            practiceFormSubtitle = "Switch scripts between Latin and Han/CJK variants when a form asks for a specific script.",
            humanOnlyPrompt = "Account purpose (human choice — Vowkey never guesses)",
            fields = listOf(
                VowkeySampleField(
                    key = "name.full",
                    cardLabel = "NAME (LATIN / LOCAL SCRIPT)",
                    printedValue = "Nguyễn Thị Linh",
                    practiceFormLabel = "Full name",
                    practiceFillValue = "Nguyễn Thị Linh",
                    primaryScript = "Latn",
                    alternateValue = "阮 氏玲",
                    alternateScript = "Hani",
                ),
                VowkeySampleField(
                    key = "id.residence_card.number",
                    cardLabel = "CARD NUMBER",
                    printedValue = "AB12345678",
                    practiceFormLabel = "Residence card number",
                    practiceFillValue = "AB12345678",
                ),
                VowkeySampleField(
                    key = "birth.date",
                    cardLabel = "DATE OF BIRTH",
                    printedValue = "1994-11-03",
                    practiceFormLabel = "Date of birth",
                    practiceFillValue = "1994-11-03",
                ),
                VowkeySampleField(
                    key = "person.nationality",
                    cardLabel = "NATIONALITY / REGION",
                    printedValue = "Việt Nam",
                    practiceFormLabel = "Nationality",
                    practiceFillValue = "Việt Nam",
                ),
                VowkeySampleField(
                    key = "address.full",
                    cardLabel = "RESIDENTIAL ADDRESS",
                    printedValue = "2-14-8 Jingumae, Shibuya-ku, Tokyo",
                    practiceFormLabel = "Current address",
                    practiceFillValue = "2-14-8 Jingumae, Shibuya-ku, Tokyo",
                    primaryScript = "Latn",
                    alternateValue = "東京都渋谷区神宮前2-14-8",
                    alternateScript = "Jpan",
                ),
                VowkeySampleField(
                    key = "visa.expiry",
                    cardLabel = "PERIOD OF STAY EXPIRES",
                    printedValue = "2028-05-20",
                    practiceFormLabel = "Stay expiration date",
                    practiceFillValue = "2028-05-20",
                ),
            ),
        ),
    )

    fun scenarioForId(id: String): VowkeySampleScenario? = scenarios.firstOrNull { it.id == id }

    fun scenarioForCipher(cipher: CipherView): VowkeySampleScenario? {
        val fields = cipher.fields.orEmpty()
        for (scenario in scenarios) {
            if (cipher.name.contains(scenario.profileName.substringBefore(" (Sample)"), ignoreCase = true) &&
                (cipher.name.contains("(Sample)", ignoreCase = true) ||
                    fields.any { it.name == "vk.sample" && it.value == scenario.id })
            ) {
                return scenario
            }
        }
        return null
    }

    fun isSampleCipher(cipher: CipherView): Boolean {
        if (cipher.name.contains("(Sample)", ignoreCase = true)) return true
        return cipher.fields.orEmpty().any { it.name == "vk.sample" }
    }

    fun fieldBox(index: Int): Pair<RectF, JsonObject> {
        val col = index % 2
        val row = index / 2
        val x = if (col == 0) 248f else 604f
        val y = 148f + row * 116f
        val w = 316f
        val h = 84f
        val rect = RectF(x, y, x + w, y + h)
        val locator = buildJsonObject {
            put("page", 0)
            put("x", (x / CARD_W).toDouble())
            put("y", (y / CARD_H).toDouble())
            put("w", (w / CARD_W).toDouble())
            put("h", (h / CARD_H).toDouble())
        }
        return rect to locator
    }

    fun renderSampleBitmap(scenario: VowkeySampleScenario): Bitmap {
        val bmp = Bitmap.createBitmap(CARD_W.toInt(), CARD_H.toInt(), Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG)

        paint.style = Paint.Style.FILL
        paint.color = AndroidColor.rgb(250, 249, 245)
        canvas.drawRoundRect(RectF(0f, 0f, CARD_W, CARD_H), 28f, 28f, paint)

        paint.color = scenario.bannerColorArgb
        canvas.drawRoundRect(RectF(0f, 0f, CARD_W, 112f), 28f, 28f, paint)
        canvas.drawRect(0f, 76f, CARD_W, 112f, paint)

        val titlePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = AndroidColor.WHITE
            textSize = 23f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        canvas.drawText(scenario.issuerHeader, 36f, 50f, titlePaint)

        val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = AndroidColor.argb(220, 255, 255, 255)
            textSize = 15f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }
        canvas.drawText("${scenario.cardSubtitle}   ·   SPECIMEN / SAMPLE", 36f, 82f, subPaint)

        // Portrait silhouette box on left
        paint.color = AndroidColor.rgb(233, 231, 224)
        canvas.drawRoundRect(RectF(36f, 148f, 218f, 444f), 16f, 16f, paint)
        paint.style = Paint.Style.STROKE
        paint.strokeWidth = 2f
        paint.color = AndroidColor.rgb(206, 203, 194)
        canvas.drawRoundRect(RectF(36f, 148f, 218f, 444f), 16f, 16f, paint)

        val initPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = scenario.bannerColorArgb
            textSize = 48f
            textAlign = Paint.Align.CENTER
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        canvas.drawText(
            VowkeyMobileFormat.initials(scenario.profileName),
            127f,
            312f,
            initPaint,
        )

        val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = AndroidColor.rgb(102, 105, 115)
            textSize = 13f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val valPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = AndroidColor.rgb(20, 21, 26)
            textSize = 22f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.BOLD)
        }
        val altPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = AndroidColor.rgb(72, 75, 86)
            textSize = 15f
            typeface = Typeface.create(Typeface.SANS_SERIF, Typeface.NORMAL)
        }

        scenario.fields.forEachIndexed { idx, field ->
            val (box, _) = fieldBox(idx)
            paint.style = Paint.Style.FILL
            paint.color = AndroidColor.WHITE
            canvas.drawRoundRect(box, 10f, 10f, paint)
            paint.style = Paint.Style.STROKE
            paint.strokeWidth = 1.5f
            paint.color = AndroidColor.rgb(225, 223, 216)
            canvas.drawRoundRect(box, 10f, 10f, paint)

            canvas.drawText(field.cardLabel, box.left + 12f, box.top + 22f, labelPaint)
            val displayVal = if (field.printedValue.length > 26) {
                field.printedValue.take(25) + "…"
            } else {
                field.printedValue
            }
            canvas.drawText(displayVal, box.left + 12f, box.top + 52f, valPaint)
            if (field.alternateValue != null) {
                canvas.drawText(field.alternateValue, box.left + 12f, box.top + 74f, altPaint)
            }
        }

        // MRZ band
        paint.style = Paint.Style.FILL
        paint.color = AndroidColor.rgb(239, 238, 233)
        canvas.drawRect(0f, 504f, CARD_W, CARD_H, paint)
        val mrzPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = AndroidColor.rgb(38, 40, 46)
            textSize = 20f
            typeface = Typeface.MONOSPACE
        }
        canvas.drawText(scenario.footerLine1, 36f, 552f, mrzPaint)
        canvas.drawText(scenario.footerLine2, 36f, 594f, mrzPaint)
        return bmp
    }

    fun renderSamplePngBytes(scenario: VowkeySampleScenario): ByteArray {
        val bmp = renderSampleBitmap(scenario)
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.PNG, 100, out)
        return out.toByteArray()
    }

    fun buildSampleCipher(
        scenario: VowkeySampleScenario,
        attachmentId: String = "$SAMPLE_ATTACHMENT_PREFIX${scenario.id}",
        pngSize: Long = 0L,
    ): CipherView {
        val cipherId = UUID.randomUUID().toString()
        val sourceId = "sample-source-${scenario.id}"
        val detailsJson = scenario.fields.mapIndexed { idx, field ->
            val (_, locator) = fieldBox(idx)
            val primaryId = UUID.randomUUID().toString()
            val variants = buildList {
                add(
                    buildJsonObject {
                        put("id", primaryId)
                        put("script", field.primaryScript?.let(::JsonPrimitive) ?: JsonNull)
                        put("tag", JsonNull)
                        put("value", field.printedValue)
                        put("current", true)
                        put("sourceId", sourceId)
                        put("locator", locator)
                        put("verified", true)
                        put("origin", "ocr")
                    },
                )
                if (field.alternateValue != null) {
                    add(
                        buildJsonObject {
                            put("id", UUID.randomUUID().toString())
                            put("script", field.alternateScript?.let(::JsonPrimitive) ?: JsonNull)
                            put("tag", JsonNull)
                            put("value", field.alternateValue)
                            put("current", true)
                            put("sourceId", sourceId)
                            put("locator", locator)
                            put("verified", true)
                            put("origin", "derived")
                        },
                    )
                }
            }
            buildJsonObject {
                put("id", UUID.randomUUID().toString())
                put("attribute", field.key)
                put("label", humanDetailLabel(field.key))
                put("valueType", if (field.key.contains("date") || field.key.contains("expiry")) "date" else "text")
                put("chosenVariantId", primaryId)
                put("agentRule", if (field.key.startsWith("id.")) "ask" else "fill")
                put("variants", JsonArray(variants))
                put("history", JsonArray(emptyList()))
                put("conflicts", JsonArray(emptyList()))
            }
        }
        val sourceRecord = buildJsonObject {
            put("id", sourceId)
            put("attachmentId", attachmentId)
            put("fileName", scenario.fileName)
            put("mediaType", "image/png")
            put("kind", "document")
            put("documentKind", scenario.documentKind)
            put("documentDate", scenario.documentDate)
            put("effectiveOn", scenario.documentDate)
            put("capturedAt", Instant.now().toString())
            put("expiresOn", scenario.expiresOn)
            put("status", "current")
        }
        val meta = buildJsonObject {
            put("v", 1)
            put("profileId", cipherId)
            put("kind", "person")
            put("relationship", JsonNull)
            put("status", "confirmed")
            put("details", JsonArray(detailsJson))
            put("sources", JsonArray(listOf(sourceRecord)))
        }
        val sampleField = FieldView("vk.sample", scenario.id, FieldType.HIDDEN, null)
        val base = newNativeCipher(CipherType.IDENTITY).copy(
            id = cipherId,
            name = scenario.profileName,
            fields = listOf(sampleField),
            attachments = null,
        )
        return base.withProfileEnvelope(meta)
    }
}
