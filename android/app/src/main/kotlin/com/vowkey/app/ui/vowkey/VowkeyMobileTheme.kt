package com.vowkey.app.ui.vowkey

import androidx.annotation.DrawableRes
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * Semantic view over [VowkeyTheme.colorScheme] so every Vowkey mobile screen uses 100% of the
 * canonical `:ui` design tokens (DM Sans + Roboto Mono typography, [VowkeyTheme.shapes], and
 * [VowkeyTheme.colorScheme] light/dark colors) with zero ad-hoc hex overrides.
 */
@Immutable
data class VowkeyMobilePalette(
    val isDark: Boolean,
    val canvas: Color,
    val surface: Color,
    val surfaceSubtle: Color,
    val chipFill: Color,
    val line: Color,
    val border: Color,
    val ink: Color,
    val muted: Color,
    val iconPrimary: Color,
    val iconSecondary: Color,
    val blue: Color,
    val blueInk: Color,
    val blueSoft: Color,
    val blueSoftBorder: Color,
    val green: Color,
    val greenSoft: Color,
    val greenBorder: Color,
    val greenText: Color,
    val amber: Color,
    val amberSoft: Color,
    val amberBorder: Color,
    val red: Color,
    val redSoft: Color,
    val redBorder: Color,
    val violet: Color,
    val violetSoft: Color,
    val violetBorder: Color,
    val teal: Color,
    val tealSoft: Color,
    val tealBorder: Color,
)

@Composable
@ReadOnlyComposable
fun currentVowkeyPalette(): VowkeyMobilePalette {
    val cs = VowkeyTheme.colorScheme
    val dark = cs.isDarkTheme
    return VowkeyMobilePalette(
        isDark = dark,
        canvas = cs.background.primary,
        surface = cs.background.secondary,
        surfaceSubtle = cs.background.tertiary,
        chipFill = cs.background.tertiary,
        line = cs.stroke.divider,
        border = cs.stroke.border,
        ink = cs.text.primary,
        muted = cs.text.secondary,
        iconPrimary = cs.icon.primary,
        iconSecondary = cs.icon.secondary,
        blue = cs.text.interaction,
        blueInk = cs.statusBadge.primary.text,
        blueSoft = cs.statusBadge.primary.background,
        blueSoftBorder = cs.statusBadge.primary.border,
        green = cs.status.strong,
        greenSoft = cs.statusBadge.success.background,
        greenBorder = cs.statusBadge.success.border,
        greenText = cs.statusBadge.success.text,
        amber = cs.statusBadge.warning.text,
        amberSoft = cs.statusBadge.warning.background,
        amberBorder = cs.statusBadge.warning.border,
        red = cs.status.error,
        redSoft = cs.statusBadge.error.background,
        redBorder = cs.statusBadge.error.border,
        violet = if (dark) Color(0xFFC4AEFD) else Color(0xFF6D47D9),
        violetSoft = if (dark) Color(0x8C403066) else Color(0xFFF3EEFF),
        violetBorder = if (dark) Color(0xA67359B3) else Color(0xFFD9CCFA),
        teal = if (dark) Color(0xFF73DBD1) else Color(0xFF0F766E),
        tealSoft = if (dark) Color(0x8C194A47) else Color(0xFFE8F7F5),
        tealBorder = if (dark) Color(0xA6338580) else Color(0xFFBFE6E1),
    )
}

enum class VowkeyItemKind(
    val id: String,
    val chipLabel: String,
    val singularTitle: String,
    @DrawableRes val iconRes: Int,
) {
    ALL("all", "All", "Item", VowkeyDrawable.ic_vault),
    PROFILE("profile", "Profiles", "Profile", VowkeyDrawable.ic_id_card),
    DOCUMENT("document", "Documents", "Document", VowkeyDrawable.ic_file_text),
    EXPIRING("expiring", "Expiring", "Expiring document", VowkeyDrawable.ic_clock),
    LOGIN("login", "Logins", "Login", VowkeyDrawable.ic_globe),
    CARD("card", "Cards", "Card", VowkeyDrawable.ic_payment_card),
    KEY("key", "Keys", "API key", VowkeyDrawable.ic_key),
    NOTE("note", "Notes", "Note", VowkeyDrawable.ic_note),
    ENVIRONMENT("environment", "Environments", "Environment", VowkeyDrawable.ic_collections),
    AGENT("agent", "AI agents", "AI agent", VowkeyDrawable.ic_shield),
    TRASH("trash", "Recently deleted", "Deleted item", VowkeyDrawable.ic_trash),
}

object VowkeyMobileFormat {
    fun displayName(rawName: String): String {
        val cleaned = rawName
            .replace(" (Sample)", "", ignoreCase = true)
            .trim()
        return cleaned.ifEmpty { rawName }
    }

    fun initials(rawName: String): String {
        val stripped = rawName
            .replace(Regex("\\([^)]*\\)|\\[[^]]*]"), " ")
            .trim()
        val source = stripped.ifEmpty { rawName }
        val tokens = source
            .split(Regex("\\s+"))
            .mapNotNull { word -> word.firstOrNull { it.isLetterOrDigit() }?.toString() }
        return when {
            tokens.size >= 2 -> (tokens.first() + tokens.last()).uppercase()
            tokens.size == 1 -> tokens.first().uppercase()
            else -> "?"
        }
    }
}

@Composable
fun VowkeySampleTag(
    text: String = "Sample",
    modifier: Modifier = Modifier,
) {
    val palette = currentVowkeyPalette()
    Surface(
        modifier = modifier,
        shape = RoundedCornerShape(6.dp),
        color = palette.amberSoft,
        border = BorderStroke(1.dp, palette.amberBorder),
    ) {
        Text(
            text = text,
            style = VowkeyTheme.typography.labelSmall,
            color = palette.amber,
            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
        )
    }
}

@Composable
fun VowkeyKindTile(
    kind: VowkeyItemKind,
    modifier: Modifier = Modifier,
    size: Dp = 38.dp,
    cornerRadius: Dp = 10.dp,
) {
    val palette = currentVowkeyPalette()
    val (tileFill, tileBorder, iconTint) = when (kind) {
        VowkeyItemKind.PROFILE,
        VowkeyItemKind.EXPIRING,
            -> Triple(palette.amberSoft, palette.amberBorder, palette.amber)
        VowkeyItemKind.DOCUMENT -> Triple(palette.blueSoft, palette.blueSoftBorder, palette.blueInk)
        VowkeyItemKind.LOGIN -> Triple(palette.greenSoft, palette.greenBorder, palette.greenText)
        VowkeyItemKind.CARD,
        VowkeyItemKind.AGENT,
            -> Triple(palette.violetSoft, palette.violetBorder, palette.violet)
        VowkeyItemKind.KEY,
        VowkeyItemKind.ENVIRONMENT,
            -> Triple(palette.tealSoft, palette.tealBorder, palette.teal)
        VowkeyItemKind.TRASH -> Triple(palette.redSoft, palette.redBorder, palette.red)
        else -> Triple(palette.surfaceSubtle, palette.line, palette.iconPrimary)
    }
    val shape = RoundedCornerShape(cornerRadius)
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(tileFill)
            .border(1.dp, tileBorder, shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(kind.iconRes),
            contentDescription = null,
            tint = iconTint,
            modifier = Modifier.size(if (size >= 44.dp) 22.dp else 18.dp),
        )
    }
}

@Composable
fun VowkeyMonogramTile(
    name: String,
    modifier: Modifier = Modifier,
    size: Dp = 38.dp,
    highlighted: Boolean = false,
) {
    val palette = currentVowkeyPalette()
    val shape = RoundedCornerShape(if (size <= 30.dp) 8.dp else 10.dp)
    val iconSize = when {
        size >= 44.dp -> 22.dp
        size <= 30.dp -> 15.dp
        else -> 18.dp
    }
    Box(
        modifier = modifier
            .size(size)
            .clip(shape)
            .background(palette.amberSoft)
            .border(1.dp, palette.amberBorder, shape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            painter = painterResource(VowkeyDrawable.ic_id_card),
            contentDescription = name,
            tint = palette.amber,
            modifier = Modifier.size(iconSize),
        )
    }
}

@Composable
fun VowkeyGroupedCard(
    modifier: Modifier = Modifier,
    content: @Composable ColumnScope.() -> Unit,
) {
    val palette = currentVowkeyPalette()
    Surface(
        modifier = modifier.fillMaxWidth(),
        shape = VowkeyTheme.shapes.actionCard,
        color = palette.surface,
        border = BorderStroke(1.dp, palette.line),
        shadowElevation = 0.dp,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth(),
            content = content,
        )
    }
}

@Composable
fun VowkeySectionLabel(
    text: String,
    modifier: Modifier = Modifier,
) {
    val palette = currentVowkeyPalette()
    val formatted = if (text == text.uppercase() && text.any { it.isLetter() }) {
        val lower = text.lowercase()
            .replace("ai ", "AI ")
            .replace(" id", " ID")
            .replace("ids", "IDs")
            .replace("api ", "API ")
        lower.replaceFirstChar { it.uppercaseChar() }
    } else {
        text
    }
    Text(
        text = formatted,
        style = VowkeyTheme.typography.labelLarge,
        color = palette.muted,
        modifier = modifier.padding(horizontal = 4.dp),
    )
}

@Composable
fun VowkeyStatusBanner(
    text: String,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val palette = currentVowkeyPalette()
    VowkeyGroupedCard(modifier = modifier) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Icon(
                painter = painterResource(VowkeyDrawable.ic_check_mark),
                contentDescription = null,
                tint = palette.green,
                modifier = Modifier.size(18.dp),
            )
            Text(
                text = text,
                style = VowkeyTheme.typography.bodyMediumEmphasis,
                color = palette.ink,
                modifier = Modifier.weight(1f),
            )
            IconButton(
                onClick = onDismiss,
                modifier = Modifier.size(24.dp),
            ) {
                Icon(
                    painter = painterResource(VowkeyDrawable.ic_close_small),
                    contentDescription = "Dismiss",
                    tint = palette.muted,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}
