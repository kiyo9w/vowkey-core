package com.vowkey.ui.platform.components.button

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.vowkey.ui.platform.components.button.model.VowkeyHelpButtonData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme

/**
 * A filled icon button that displays an icon.
 *
 * @param helpData All the relevant data for displaying a help icon button.
 * @param modifier A [Modifier] for the composable.
 */
@Composable
fun VowkeyHelpIconButton(
    helpData: VowkeyHelpButtonData,
    modifier: Modifier = Modifier,
) {
    VowkeyStandardIconButton(
        vectorIconRes = VowkeyDrawable.ic_question_circle_small,
        contentDescription = if (helpData.isExternalLink) {
            stringResource(
                id = VowkeyString.external_link_format,
                formatArgs = arrayOf(helpData.contentDescription),
            )
        } else {
            helpData.contentDescription
        },
        onClick = helpData.onClick,
        contentColor = VowkeyTheme.colorScheme.icon.secondary,
        modifier = modifier,
    )
}
