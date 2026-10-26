package com.vowkey.app.ui.vault.feature.importlogins.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toAnnotatedString
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.card.VowkeyContentCard
import com.vowkey.ui.platform.components.content.model.ContentBlockData
import com.vowkey.ui.platform.components.text.VowkeyHyperTextLink
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.persistentListOf

/**
 * Reusable component for each step of the import logins flow.
 */
@Suppress("LongMethod")
@Composable
fun ImportLoginsInstructionStep(
    stepText: String,
    stepTitle: String,
    instructions: ImmutableList<ContentBlockData>,
    onBackClick: () -> Unit,
    onContinueClick: () -> Unit,
    onHelpClick: () -> Unit,
    modifier: Modifier = Modifier,
    ctaText: String = stringResource(VowkeyString.continue_text),
) {
    Column(
        modifier = modifier.verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Text(
            text = stepText,
            style = VowkeyTheme.typography.titleSmall,
        )
        Spacer(Modifier.height(12.dp))
        Text(text = stepTitle, style = VowkeyTheme.typography.titleMedium)
        Spacer(Modifier.height(24.dp))
        VowkeyContentCard(
            contentItems = instructions,
            modifier = Modifier
                .standardHorizontalMargin(),
            contentHeaderTextStyle = VowkeyTheme.typography.bodyMedium,
            contentSubtitleTextStyle = VowkeyTheme.typography.labelSmall,
        )
        Spacer(Modifier.height(24.dp))
        VowkeyHyperTextLink(
            annotatedResId = VowkeyString.need_help_check_out_import_help,
            annotationKey = "importHelp",
            accessibilityString = stringResource(id = VowkeyString.import_help),
            onClick = onHelpClick,
            style = VowkeyTheme.typography.bodySmall,
            isExternalLink = true,
            modifier = Modifier.standardHorizontalMargin(),
        )
        Spacer(Modifier.height(24.dp))
        VowkeyFilledButton(
            label = ctaText,
            onClick = onContinueClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(Modifier.height(12.dp))
        VowkeyOutlinedButton(
            label = stringResource(VowkeyString.back),
            onClick = onBackClick,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(Modifier.navigationBarsPadding())
    }
}

@Preview
@Composable
private fun ImportLoginsInstructionStep_preview() {
    VowkeyTheme {
        Column(modifier = Modifier.background(VowkeyTheme.colorScheme.background.primary)) {
            ImportLoginsInstructionStep(
                stepText = "Step text",
                stepTitle = "Step title",
                instructions = persistentListOf(
                    ContentBlockData(
                        iconVectorResource = VowkeyDrawable.ic_number1,
                        headerText = buildAnnotatedString {
                            append("Step text 1")
                            withStyle(
                                SpanStyle(
                                    fontWeight = FontWeight.Bold,
                                    fontFamily = VowkeyTheme.typography.bodyMedium.fontFamily,
                                ),
                            ) {
                                append(" with bold text")
                            }
                        },
                        subtitleText = null,
                    ),
                    ContentBlockData(
                        iconVectorResource = VowkeyDrawable.ic_number2,
                        headerText = buildAnnotatedString {
                            append("Step text 2")
                        },
                        subtitleText = "Added deets".toAnnotatedString(),
                    ),
                    ContentBlockData(
                        iconVectorResource = VowkeyDrawable.ic_number3,
                        headerText = buildAnnotatedString {
                            append("Step text 3")
                        },
                    ),
                ),
                onBackClick = {},
                onContinueClick = {},
                onHelpClick = {},
            )
        }
    }
}
