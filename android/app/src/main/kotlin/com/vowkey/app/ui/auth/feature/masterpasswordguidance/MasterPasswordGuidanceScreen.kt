package com.vowkey.app.ui.auth.feature.masterpasswordguidance

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.annotatedStringResource
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.base.util.toAnnotatedString
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyActionCard
import com.vowkey.ui.platform.components.card.VowkeyContentCard
import com.vowkey.ui.platform.components.content.model.ContentBlockData
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import kotlinx.collections.immutable.persistentListOf

/**
 * The top level composable for the Master Password Guidance screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MasterPasswordGuidanceScreen(
    onNavigateBack: () -> Unit,
    onNavigateToGeneratePassword: () -> Unit,
    viewModel: MasterPasswordGuidanceViewModel = hiltViewModel(),
) {
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            MasterPasswordGuidanceEvent.NavigateBack -> onNavigateBack()
            MasterPasswordGuidanceEvent.NavigateToPasswordGenerator -> {
                onNavigateToGeneratePassword()
            }
        }
    }

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.master_password),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = {
                    viewModel.trySendAction(MasterPasswordGuidanceAction.CloseAction)
                },
            )
        },
    ) {
        MasterPasswordGuidanceContent(
            onTryPasswordGeneratorAction = {
                viewModel.trySendAction(MasterPasswordGuidanceAction.TryPasswordGeneratorAction)
            },
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .standardHorizontalMargin(),
        )
    }
}

@Composable
private fun MasterPasswordGuidanceContent(
    onTryPasswordGeneratorAction: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Spacer(modifier = Modifier.height(24.dp))
        Text(
            text = stringResource(VowkeyString.a_secure_memorable_password),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.titleMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = stringResource(
                VowkeyString.one_of_the_best_ways_to_create_a_secure_and_memorable_password,
            ),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.bodyMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp),
        )
        Spacer(modifier = Modifier.height(24.dp))
        MasterPasswordGuidanceContentBlocks()
        NeedSomeInspirationCard(
            onActionClicked = {
                onTryPasswordGeneratorAction()
            },
        )
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Suppress("MaxLineLength")
@Composable
private fun MasterPasswordGuidanceContentBlocks(modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        VowkeyContentCard(
            contentItems = persistentListOf(
                ContentBlockData(
                    headerText = stringResource(VowkeyString.choose_three_or_four_random_words)
                        .toAnnotatedString(),
                    subtitleText = annotatedStringResource(
                        id = VowkeyString.pick_three_or_four_random_unrelated_words,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_number1,
                ),
                ContentBlockData(
                    headerText = stringResource(VowkeyString.combine_those_words_together)
                        .toAnnotatedString(),
                    subtitleText = annotatedStringResource(
                        id = VowkeyString.put_the_words_together_in_any_order_to_form_your_passphrase,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_number2,
                ),
                ContentBlockData(
                    headerText = stringResource(VowkeyString.make_it_yours).toAnnotatedString(),
                    subtitleText = annotatedStringResource(
                        id = VowkeyString.add_a_number_or_symbol_to_make_it_even_stronger,
                    ),
                    iconVectorResource = VowkeyDrawable.ic_number3,
                ),
            ),
        )
    }
    Spacer(modifier = Modifier.height(24.dp))
}

@Composable
private fun NeedSomeInspirationCard(
    onActionClicked: () -> Unit,
    modifier: Modifier = Modifier,
) {
    VowkeyActionCard(
        cardTitle = stringResource(VowkeyString.need_some_inspiration),
        actionButton = VowkeyButtonData(
            label = VowkeyString.check_out_the_passphrase_generator.asText(),
            onClick = onActionClicked,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

@Preview
@Composable
private fun MasterPasswordGuidanceScreenPreview() {
    VowkeyTheme {
        MasterPasswordGuidanceScreen(
            onNavigateBack = {},
            onNavigateToGeneratePassword = {},
        )
    }
}
