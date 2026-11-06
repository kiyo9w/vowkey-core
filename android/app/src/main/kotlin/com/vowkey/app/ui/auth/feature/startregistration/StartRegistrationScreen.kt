package com.vowkey.app.ui.auth.feature.startregistration

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
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
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.tooling.preview.PreviewScreenSizes
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.annotatedStringResource
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.auth.feature.landing.SocialSignInSection
import com.vowkey.app.ui.auth.feature.landing.VowkeyBrandHeader
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.ErrorDialogDismiss
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToPrivacyPolicy
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToTerms
import com.vowkey.app.ui.auth.feature.startregistration.handlers.StartRegistrationHandler
import com.vowkey.app.ui.auth.feature.startregistration.handlers.rememberStartRegistrationHandler
import com.vowkey.app.ui.platform.components.dropdown.EnvironmentSelector
import com.vowkey.app.ui.platform.composition.LocalAuthTabLaunchers
import com.vowkey.app.ui.platform.model.AuthTabLaunchers

/**
 * Top level composable for the start registration screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StartRegistrationScreen(
    onNavigateBack: () -> Unit,
    onNavigateToCompleteRegistration: (emailAddress: String, verificationToken: String) -> Unit,
    onNavigateToCheckEmail: (email: String) -> Unit,
    onNavigateToEnvironment: () -> Unit,
    onNavigateToTwoFactorLogin: (emailAddress: String, orgIdentifier: String?) -> Unit = { _, _ -> },
    authTabLaunchers: AuthTabLaunchers = LocalAuthTabLaunchers.current,
    intentManager: IntentManager = LocalIntentManager.current,
    viewModel: StartRegistrationViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handler = rememberStartRegistrationHandler(viewModel = viewModel)
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel) { event ->
        when (event) {
            is NavigateToPrivacyPolicy -> {
                intentManager.launchUri("https://vowkey.app/privacy".toUri())
            }

            is NavigateToTerms -> intentManager.launchUri("https://vowkey.app/terms".toUri())
            is StartRegistrationEvent.NavigateToUnsubscribe -> {
                intentManager.launchUri("https://vowkey.app".toUri())
            }

            is StartRegistrationEvent.NavigateToServerSelectionInfo -> {
                intentManager.launchUri("https://vowkey.app/#security".toUri())
            }

            is StartRegistrationEvent.NavigateBack -> onNavigateBack.invoke()
            is StartRegistrationEvent.NavigateToCompleteRegistration -> {
                onNavigateToCompleteRegistration(event.email, event.verificationToken)
            }

            is StartRegistrationEvent.NavigateToCheckEmail -> onNavigateToCheckEmail(event.email)
            StartRegistrationEvent.NavigateToEnvironment -> onNavigateToEnvironment()
            is StartRegistrationEvent.NavigateToSocialSignIn -> intentManager.startAuthTab(
                uri = event.uri,
                authTabData = event.authTabData,
                launcher = authTabLaunchers.sso,
            )
            is StartRegistrationEvent.NavigateToTwoFactorLogin -> {
                onNavigateToTwoFactorLogin(event.emailAddress, event.orgIdentifier)
            }
            is StartRegistrationEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    StartRegistrationDialogs(
        dialog = state.dialog,
        onDismissRequest = { viewModel.trySendAction(ErrorDialogDismiss) },
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = VowkeyString.create_account),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                navigationIconContentDescription = stringResource(id = VowkeyString.close),
                onNavigationIconClick = handler.onCloseClick,
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        StartRegistrationContent(
            state = state,
            handler = handler,
        )
    }
}

@Composable
private fun StartRegistrationDialogs(
    dialog: StartRegistrationDialog?,
    onDismissRequest: () -> Unit,
) {
    when (dialog) {
        is StartRegistrationDialog.Error -> {
            VowkeyBasicDialog(
                title = dialog.title?.invoke(),
                message = dialog.message(),
                throwable = dialog.error,
                onDismissRequest = onDismissRequest,
            )
        }

        StartRegistrationDialog.Loading -> {
            VowkeyLoadingDialog(text = stringResource(id = VowkeyString.create_account))
        }

        null -> Unit
    }
}

@Suppress("LongMethod")
@Composable
private fun StartRegistrationContent(
    state: StartRegistrationState,
    handler: StartRegistrationHandler,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(height = 12.dp))

        Spacer(modifier = Modifier.weight(1f))
        VowkeyBrandHeader(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        if (state.isSocialLoginEnabled) {
            SocialSignInSection(
                showOrDivider = true,
                onSelectProvider = handler.onSocialSignInClick,
                modifier = Modifier
                    .fillMaxWidth()
                    .standardHorizontalMargin(),
            )

            Spacer(modifier = Modifier.height(16.dp))
        }

        VowkeyTextField(
            label = stringResource(id = VowkeyString.email_address_required),
            value = state.emailInput,
            onValueChange = handler.onEmailInputChange,
            keyboardType = KeyboardType.Email,
            textFieldTestTag = "EmailAddressEntry",
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                EnvironmentSelector(
                    labelText = stringResource(id = VowkeyString.create_account_on_with_colon),
                    dialogTitle = stringResource(id = VowkeyString.create_account_on),
                    options = state.environmentTypeOptions,
                    selectedOption = state.selectedEnvironmentType,
                    onOptionSelected = handler.onEnvironmentTypeSelect,
                    onHelpClick = handler.onServerGeologyHelpClick,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(tag = "RegionSelectorDropdown"),
                )
            },
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(8.dp))

        VowkeyTextField(
            label = stringResource(id = VowkeyString.name),
            value = state.nameInput,
            onValueChange = handler.onNameInputChange,
            textFieldTestTag = "NameEntry",
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.continue_text),
            onClick = handler.onContinueClick,
            isEnabled = state.isContinueButtonEnabled,
            modifier = Modifier
                .testTag("ContinueButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(12.dp))

        TermsAndPrivacyText(
            onTermsClick = handler.onTermsClick,
            onPrivacyPolicyClick = handler.onPrivacyPolicyClick,
            modifier = Modifier.standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.weight(1f))
        Spacer(modifier = Modifier.height(12.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun TermsAndPrivacyText(
    onTermsClick: () -> Unit,
    onPrivacyPolicyClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val strTerms = stringResource(
        id = VowkeyString.external_link_format,
        formatArgs = arrayOf(stringResource(id = VowkeyString.terms_of_service)),
    )
    val strPrivacy = stringResource(
        id = VowkeyString.external_link_format,
        formatArgs = arrayOf(stringResource(id = VowkeyString.privacy_policy)),
    )
    Row(
        horizontalArrangement = Arrangement.Start,
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .semantics(mergeDescendants = true) {
                testTag = "DisclaimerText"
                customActions = listOf(
                    CustomAccessibilityAction(
                        label = strTerms,
                        action = {
                            onTermsClick()
                            true
                        },
                    ),
                    CustomAccessibilityAction(
                        label = strPrivacy,
                        action = {
                            onPrivacyPolicyClick()
                            true
                        },
                    ),
                )
            }
            .padding(horizontal = 16.dp)
            .fillMaxWidth(),
    ) {
        Text(
            text = annotatedStringResource(
                id = VowkeyString
                    .by_continuing_you_agree_to_the_terms_of_service_and_privacy_policy,
                onAnnotationClick = {
                    when (it) {
                        "termsOfService" -> onTermsClick()
                        "privacyPolicy" -> onPrivacyPolicyClick()
                    }
                },
            ),
            style = VowkeyTheme.typography.bodyMedium.copy(
                textAlign = TextAlign.Center,
            ),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@PreviewScreenSizes
@Composable
private fun StartRegistrationContentFilledOut_preview() {
    VowkeyTheme {
        StartRegistrationContent(
            state = StartRegistrationState(
                emailInput = "e@mail.com",
                selectedEnvironmentType = Environment.Type.US,
                nameInput = "Test User",
                isReceiveMarketingEmailsToggled = true,
                isContinueButtonEnabled = true,
                dialog = null,
            ),
            handler = StartRegistrationHandler(
                onEmailInputChange = {},
                onNameInputChange = {},
                onEnvironmentTypeSelect = {},
                onContinueClick = {},
                onTermsClick = {},
                onPrivacyPolicyClick = {},
                onReceiveMarketingEmailsToggle = {},
                onUnsubscribeMarketingEmailsClick = {},
                onServerGeologyHelpClick = {},
                onCloseClick = {},
            ),
        )
    }
}

@Preview(showBackground = true)
@Composable
private fun StartRegistrationContentEmpty_preview() {
    VowkeyTheme {
        StartRegistrationContent(
            state = StartRegistrationState(
                emailInput = "",
                selectedEnvironmentType = Environment.Type.US,
                nameInput = "",
                isReceiveMarketingEmailsToggled = false,
                isContinueButtonEnabled = false,
                dialog = null,
            ),
            handler = StartRegistrationHandler(
                onEmailInputChange = {},
                onNameInputChange = {},
                onEnvironmentTypeSelect = {},
                onContinueClick = {},
                onTermsClick = {},
                onPrivacyPolicyClick = {},
                onReceiveMarketingEmailsToggle = {},
                onUnsubscribeMarketingEmailsClick = {},
                onServerGeologyHelpClick = {},
                onCloseClick = {},
            ),
        )
    }
}
