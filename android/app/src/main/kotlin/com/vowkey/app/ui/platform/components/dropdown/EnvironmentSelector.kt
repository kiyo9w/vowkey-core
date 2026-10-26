package com.vowkey.app.ui.platform.components.dropdown

import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.ripple
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.base.util.interactiveBorder
import com.vowkey.ui.platform.components.button.VowkeyStandardIconButton
import com.vowkey.ui.platform.components.dialog.VowkeySelectionDialog
import com.vowkey.ui.platform.components.dialog.row.VowkeySelectionRow
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.util.displayLabel
import kotlinx.collections.immutable.ImmutableList

/**
 * A dropdown selector UI component specific to region url selection.
 *
 * This composable displays a dropdown menu allowing users to select a region
 * from a list of options. When an option is selected, it invokes the provided callback
 * and displays the currently selected region on the UI.
 *
 * @param labelText The text displayed near the selector button.
 * @param dialogTitle The title displayed in the selection dialog.
 * @param options The options displayed in the selection dialog.
 * @param selectedOption The currently selected environment option.
 * @param onOptionSelected A callback that gets invoked when an environment option is selected
 * and passes the selected option as an argument.
 * @param onHelpClick A callback that gets invoked when the help button is clicked.
 * @param modifier A [Modifier] for the composable.
 * @param interactionSource A [MutableInteractionSource] for observing and emitting interactions
 * for this component.
 * @param isHelpEnabled Indicates if the help button should be available.
 */
@Suppress("LongMethod")
@Composable
fun EnvironmentSelector(
    labelText: String,
    dialogTitle: String,
    options: ImmutableList<Environment.Type>,
    selectedOption: Environment.Type,
    onOptionSelected: (Environment.Type) -> Unit,
    onHelpClick: () -> Unit,
    modifier: Modifier = Modifier,
    interactionSource: MutableInteractionSource = remember { MutableInteractionSource() },
    isHelpEnabled: Boolean = true,
) {
    var shouldShowDialog by rememberSaveable { mutableStateOf(false) }
    Row(
        modifier = modifier
            .defaultMinSize(minHeight = 48.dp)
            .clickable(
                indication = ripple(color = VowkeyTheme.colorScheme.background.pressed),
                interactionSource = interactionSource,
                onClick = { shouldShowDialog = !shouldShowDialog },
            )
            .interactiveBorder(
                interactionSource = interactionSource,
                shape = VowkeyTheme.shapes.contentBottom,
            )
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(
            modifier = Modifier.padding(vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = labelText,
                style = VowkeyTheme.typography.bodySmall,
                color = VowkeyTheme.colorScheme.text.secondary,
                modifier = Modifier.padding(end = 4.dp),
            )
            Text(
                text = selectedOption.displayLabel(),
                style = VowkeyTheme.typography.labelMedium,
                color = VowkeyTheme.colorScheme.text.interaction,
                modifier = Modifier.padding(end = 8.dp),
            )
            Icon(
                painter = rememberVectorPainter(id = VowkeyDrawable.ic_chevron_down_small),
                contentDescription = stringResource(id = VowkeyString.region),
                tint = VowkeyTheme.colorScheme.icon.secondary,
            )
        }
        Spacer(modifier = Modifier.weight(weight = 1f))
        if (isHelpEnabled) {
            VowkeyStandardIconButton(
                vectorIconRes = VowkeyDrawable.ic_question_circle_small,
                contentDescription = stringResource(
                    id = VowkeyString.external_link_format,
                    formatArgs = arrayOf(
                        stringResource(id = VowkeyString.help_with_server_geolocations),
                    ),
                ),
                onClick = onHelpClick,
                contentColor = VowkeyTheme.colorScheme.icon.secondary,
                // Align with design but keep accessible touch target of IconButton.
                modifier = Modifier.offset(x = 16.dp),
            )
        }
    }

    if (shouldShowDialog) {
        VowkeySelectionDialog(
            title = dialogTitle,
            onDismissRequest = { shouldShowDialog = false },
        ) {
            options.forEach {
                VowkeySelectionRow(
                    text = it.displayLabel,
                    onClick = {
                        onOptionSelected(it)
                        shouldShowDialog = false
                    },
                    isSelected = it == selectedOption,
                )
            }
        }
    }
}
