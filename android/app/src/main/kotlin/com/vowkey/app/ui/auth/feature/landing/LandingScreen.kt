package com.vowkey.app.ui.auth.feature.landing

import com.vowkey.app.R

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.data.repository.model.Environment
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.account.VowkeyAccountSwitcher
import com.vowkey.ui.platform.components.account.VowkeyPlaceholderAccountActionItem
import com.vowkey.ui.platform.components.appbar.NavigationIcon
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyTextButton
import com.vowkey.ui.platform.components.dialog.VowkeyBasicDialog
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.field.VowkeyTextField
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.snackbar.VowkeySnackbarHost
import com.vowkey.ui.platform.components.snackbar.model.rememberVowkeySnackbarHostState
import com.vowkey.ui.platform.components.toggle.VowkeySwitch
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.app.ui.platform.components.dropdown.EnvironmentSelector
import com.vowkey.app.ui.platform.composition.LocalAuthTabLaunchers
import com.vowkey.app.ui.platform.model.AuthTabLaunchers

/**
 * The top level composable for the Landing screen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
@Suppress("LongMethod")
fun LandingScreen(
    onNavigateToLogin: (emailAddress: String) -> Unit,
    onNavigateToEnvironment: () -> Unit,
    onNavigateToStartRegistration: () -> Unit,
    onNavigateToLocalVault: () -> Unit,
    onNavigateToPreAuthSettings: () -> Unit,
    onNavigateToTwoFactorLogin: (emailAddress: String, orgIdentifier: String?) -> Unit = { _, _ -> },
    onNavigateBack: (() -> Unit)? = null,
    authTabLaunchers: AuthTabLaunchers = LocalAuthTabLaunchers.current,
    intentManager: IntentManager = LocalIntentManager.current,
    viewModel: LandingViewModel = hiltViewModel(),
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val snackbarHostState = rememberVowkeySnackbarHostState()
    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is LandingEvent.NavigateToLogin -> onNavigateToLogin(event.emailAddress)
            LandingEvent.NavigateToEnvironment -> onNavigateToEnvironment()
            LandingEvent.NavigateToStartRegistration -> onNavigateToStartRegistration()
            LandingEvent.NavigateToLocalVault -> onNavigateToLocalVault()
            LandingEvent.NavigateToSettings -> onNavigateToPreAuthSettings()
            is LandingEvent.NavigateToSocialSignIn -> intentManager.startAuthTab(
                uri = event.uri,
                authTabData = event.authTabData,
                launcher = authTabLaunchers.sso,
            )
            is LandingEvent.NavigateToTwoFactorLogin -> {
                onNavigateToTwoFactorLogin(event.emailAddress, event.orgIdentifier)
            }
            is LandingEvent.ShowSnackbar -> snackbarHostState.showSnackbar(event.data)
        }
    }

    when (val dialog = state.dialog) {
        is LandingState.DialogState.AccountAlreadyAdded -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.account_already_added),
                message = stringResource(
                    id = VowkeyString.switch_to_already_added_account_confirmation,
                ),
                confirmButtonText = stringResource(id = VowkeyString.yes),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = {
                    viewModel.trySendAction(
                        LandingAction.ConfirmSwitchToMatchingAccountClick(dialog.accountSummary),
                    )
                },
                onDismissClick = { viewModel.trySendAction(LandingAction.DialogDismiss) },
                onDismissRequest = { viewModel.trySendAction(LandingAction.DialogDismiss) },
            )
        }

        is LandingState.DialogState.Error -> {
            VowkeyBasicDialog(
                title = stringResource(id = VowkeyString.an_error_has_occurred),
                message = dialog.message(),
                onDismissRequest = { viewModel.trySendAction(LandingAction.DialogDismiss) },
            )
        }

        is LandingState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialog.message())
        }

        null -> Unit
    }

    var isAccountMenuVisible by rememberSaveable { mutableStateOf(false) }
    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(
        state = rememberTopAppBarState(),
        canScroll = { !isAccountMenuVisible },
    )

    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            if (state.isAppBarVisible || onNavigateBack != null) {
                VowkeyTopAppBar(
                    title = "",
                    scrollBehavior = scrollBehavior,
                    navigationIcon = onNavigateBack?.let { back ->
                        NavigationIcon(
                            navigationIcon = rememberVectorPainter(id = VowkeyDrawable.ic_close),
                            navigationIconContentDescription = stringResource(id = VowkeyString.close),
                            onNavigationIconClick = back,
                        )
                    },
                    actions = {
                        if (state.isAppBarVisible) {
                            VowkeyPlaceholderAccountActionItem(
                                onClick = { isAccountMenuVisible = !isAccountMenuVisible },
                            )
                        }
                    },
                )
            }
        },
        overlay = {
            VowkeyAccountSwitcher(
                isVisible = isAccountMenuVisible,
                accountSummaries = state.accountSummaries,
                onSwitchAccountClick = {
                    viewModel.trySendAction(LandingAction.SwitchAccountClick(it))
                },
                onLockAccountClick = {
                    viewModel.trySendAction(LandingAction.LockAccountClick(it))
                },
                onLogoutAccountClick = {
                    viewModel.trySendAction(LandingAction.LogoutAccountClick(it))
                },
                onAddAccountClick = {
                    // Not available
                },
                onDismissRequest = { isAccountMenuVisible = false },
                isAddAccountAvailable = false,
                topAppBarScrollBehavior = scrollBehavior,
                modifier = Modifier.fillMaxSize(),
            )
        },
        snackbarHost = {
            VowkeySnackbarHost(vowkeyHostState = snackbarHostState)
        },
    ) {
        LandingScreenContent(
            state = state,
            onEmailInputChange = { viewModel.trySendAction(LandingAction.EmailInputChanged(it)) },
            onEnvironmentTypeSelect = {
                viewModel.trySendAction(LandingAction.EnvironmentTypeSelect(it))
            },
            onRememberMeToggle = { viewModel.trySendAction(LandingAction.RememberMeToggle(it)) },
            onContinueClick = { viewModel.trySendAction(LandingAction.ContinueButtonClick) },
            onSocialSignInClick = { viewModel.trySendAction(LandingAction.SocialSignInClick(it)) },
            onContinueWithoutAccountClick = {
                viewModel.trySendAction(LandingAction.ContinueWithoutAccountClick)
            },
            onCreateAccountClick = { viewModel.trySendAction(LandingAction.CreateAccountClick) },
            onAppSettingsClick = { viewModel.trySendAction(LandingAction.AppSettingsClick) },
        )
    }
}

@Suppress("LongMethod")
@Composable
private fun LandingScreenContent(
    state: LandingState,
    onEmailInputChange: (String) -> Unit,
    onEnvironmentTypeSelect: (Environment.Type) -> Unit,
    onRememberMeToggle: (Boolean) -> Unit,
    onContinueClick: () -> Unit,
    onSocialSignInClick: (String) -> Unit,
    onContinueWithoutAccountClick: () -> Unit,
    onCreateAccountClick: () -> Unit,
    onAppSettingsClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .statusBarsPadding(),
    ) {
        Spacer(modifier = Modifier.height(height = 16.dp))
        Spacer(modifier = Modifier.weight(1f))

        VowkeyBrandHeader(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 14.dp))

        Text(
            text = stringResource(id = VowkeyString.login_to_vowkey),
            textAlign = TextAlign.Center,
            style = VowkeyTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .standardHorizontalMargin()
                .wrapContentHeight(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        if (state.isSocialLoginEnabled) {
            SocialSignInSection(
                showOrDivider = true,
                onSelectProvider = onSocialSignInClick,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth(),
            )

            Spacer(modifier = Modifier.height(height = 16.dp))
        }

        VowkeyTextField(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
            value = state.emailInput,
            onValueChange = onEmailInputChange,
            label = stringResource(id = VowkeyString.email_address),
            keyboardType = KeyboardType.Email,
            textFieldTestTag = "EmailAddressEntry",
            cardStyle = CardStyle.Full,
            supportingContentPadding = PaddingValues(),
            supportingContent = {
                EnvironmentSelector(
                    labelText = stringResource(id = VowkeyString.logging_in_on_with_colon),
                    dialogTitle = stringResource(id = VowkeyString.logging_in_on),
                    options = state.environmentTypeOptions,
                    selectedOption = state.selectedEnvironmentType,
                    onOptionSelected = onEnvironmentTypeSelect,
                    isHelpEnabled = false,
                    onHelpClick = {},
                    modifier = Modifier
                        .testTag("RegionSelectorDropdown")
                        .fillMaxWidth(),
                )
            },
        )

        Spacer(modifier = Modifier.height(height = 8.dp))

        VowkeySwitch(
            label = stringResource(id = VowkeyString.remember_email),
            isChecked = state.isRememberEmailEnabled,
            onCheckedChange = onRememberMeToggle,
            cardStyle = CardStyle.Full,
            modifier = Modifier
                .testTag("RememberMeSwitch")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.continue_text),
            onClick = onContinueClick,
            isEnabled = state.isContinueButtonEnabled,
            modifier = Modifier
                .testTag("ContinueButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.height(height = 16.dp))

        AnimatedVisibility(
            visible = state.allowCreateAccount,
            label = "CreateAccountAnimatedVisibility",
        ) {
            Row(
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth()
                    .wrapContentHeight(),
            ) {
                Text(
                    text = stringResource(id = VowkeyString.new_to_vowkey),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.text.secondary,
                )

                VowkeyTextButton(
                    label = stringResource(id = VowkeyString.create_an_account),
                    onClick = onCreateAccountClick,
                    modifier = Modifier
                        .testTag("CreateAccountLabel"),
                )
            }
        }

        VowkeyTextButton(
            label = stringResource(id = R.string.vk_local_continue),
            onClick = onContinueWithoutAccountClick,
            contentColor = VowkeyTheme.colorScheme.text.secondary,
            modifier = Modifier
                .testTag("ContinueWithoutAccountButton")
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        VowkeyTextButton(
            label = stringResource(id = VowkeyString.app_settings),
            onClick = onAppSettingsClick,
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_cog),
            contentColor = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )

        Spacer(modifier = Modifier.weight(1f))
        Spacer(modifier = Modifier.height(height = 12.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
internal fun VowkeyBrandHeader(
    modifier: Modifier = Modifier,
    horizontalArrangement: Arrangement.Horizontal = Arrangement.Center,
) {
    val cardBg = VowkeyTheme.colorScheme.background.secondary
    val cardStroke = VowkeyTheme.colorScheme.stroke.divider
    val inkColor = VowkeyTheme.colorScheme.text.primary
    val brandBlue = Color(0xFF2563EB)

    Row(
        horizontalArrangement = horizontalArrangement,
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier,
    ) {
        Canvas(modifier = Modifier.size(36.dp)) {
            val s = size.width / 120f
            drawRoundRect(
                color = cardBg,
                topLeft = Offset(1f * s, 1f * s),
                size = Size(118f * s, 118f * s),
                cornerRadius = CornerRadius(27f * s, 27f * s),
            )
            drawRoundRect(
                color = cardStroke,
                topLeft = Offset(1f * s, 1f * s),
                size = Size(118f * s, 118f * s),
                cornerRadius = CornerRadius(27f * s, 27f * s),
                style = Stroke(width = 2.5f * s),
            )

            fun tx(x: Float): Float = (60f + (x - 60f) * 0.86f) * s
            fun ty(y: Float): Float = (61f + (y - 57f) * 0.86f) * s
            val sc = 0.86f * s

            val framePath = Path().apply {
                moveTo(tx(70f), ty(40f))
                lineTo(tx(93f), ty(40f))
                cubicTo(tx(98f), ty(40f), tx(102f), ty(44f), tx(102f), ty(49f))
                lineTo(tx(102f), ty(77f))
                cubicTo(tx(102f), ty(82f), tx(98f), ty(86f), tx(93f), ty(86f))
                lineTo(tx(27f), ty(86f))
                cubicTo(tx(22f), ty(86f), tx(18f), ty(82f), tx(18f), ty(77f))
                lineTo(tx(18f), ty(49f))
                cubicTo(tx(18f), ty(44f), tx(22f), ty(40f), tx(27f), ty(40f))
                lineTo(tx(28f), ty(40f))
            }
            drawPath(
                path = framePath,
                color = inkColor,
                style = Stroke(width = 7f * sc, cap = StrokeCap.Round),
            )
            drawRoundRect(
                color = brandBlue,
                topLeft = Offset(tx(31f), ty(28f)),
                size = Size(34f * sc, 23f * sc),
                cornerRadius = CornerRadius(5f * sc, 5f * sc),
            )
            drawRoundRect(
                color = Color.White,
                topLeft = Offset(tx(37.5f), ty(37.75f)),
                size = Size(21f * sc, 3.5f * sc),
                cornerRadius = CornerRadius(1.75f * sc, 1.75f * sc),
            )
            drawCircle(color = inkColor, radius = 5f * sc, center = Offset(tx(35f), ty(65f)))
            drawCircle(color = inkColor, radius = 5f * sc, center = Offset(tx(51f), ty(65f)))
            drawCircle(color = inkColor, radius = 5f * sc, center = Offset(tx(67f), ty(65f)))
            drawRoundRect(
                color = brandBlue,
                topLeft = Offset(tx(80f), ty(54f)),
                size = Size(5.5f * sc, 22f * sc),
                cornerRadius = CornerRadius(2.75f * sc, 2.75f * sc),
            )
        }

        Spacer(modifier = Modifier.width(10.dp))

        Text(
            text = "Vowkey",
            style = VowkeyTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            color = inkColor,
        )
    }
}

@Composable
internal fun SocialSignInSection(
    showOrDivider: Boolean,
    onSelectProvider: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        verticalArrangement = Arrangement.spacedBy(10.dp),
        modifier = modifier,
    ) {
        SocialProviderButton(
            label = stringResource(id = VowkeyString.continue_with_google),
            testTag = "ContinueWithGoogleButton",
            onClick = { onSelectProvider("google") },
            icon = { GoogleMarkCanvas(modifier = Modifier.size(18.dp)) },
        )

        SocialProviderButton(
            label = stringResource(id = VowkeyString.continue_with_github),
            testTag = "ContinueWithGitHubButton",
            onClick = { onSelectProvider("github") },
            icon = {
                GitHubMarkCanvas(
                    tint = VowkeyTheme.colorScheme.text.primary,
                    modifier = Modifier.size(18.dp),
                )
            },
        )

        if (showOrDivider) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 4.dp),
            ) {
                HorizontalDivider(
                    color = VowkeyTheme.colorScheme.stroke.divider,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    text = stringResource(id = VowkeyString.or_divider),
                    style = VowkeyTheme.typography.labelMedium,
                    color = VowkeyTheme.colorScheme.text.secondary,
                    modifier = Modifier.padding(horizontal = 12.dp),
                )
                HorizontalDivider(
                    color = VowkeyTheme.colorScheme.stroke.divider,
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun SocialProviderButton(
    label: String,
    testTag: String,
    onClick: () -> Unit,
    icon: @Composable () -> Unit,
) {
    OutlinedButton(
        onClick = onClick,
        shape = RoundedCornerShape(12.dp),
        border = BorderStroke(1.dp, VowkeyTheme.colorScheme.stroke.divider),
        colors = ButtonDefaults.outlinedButtonColors(
            containerColor = VowkeyTheme.colorScheme.background.secondary,
            contentColor = VowkeyTheme.colorScheme.text.primary,
        ),
        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        modifier = Modifier
            .testTag(testTag)
            .fillMaxWidth()
            .defaultMinSize(minHeight = 48.dp),
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center,
        ) {
            icon()
            Spacer(modifier = Modifier.width(10.dp))
            Text(
                text = label,
                style = VowkeyTheme.typography.labelLarge,
                color = VowkeyTheme.colorScheme.text.primary,
            )
        }
    }
}

@Composable
private fun GoogleMarkCanvas(modifier: Modifier = Modifier) {
    Canvas(modifier = modifier) {
        val sx = size.width / 24f
        val sy = size.height / 24f

        val blue = Path().apply {
            moveTo(22.56f * sx, 12.25f * sy)
            cubicTo(22.56f * sx, 11.47f * sy, 22.49f * sx, 10.72f * sy, 22.36f * sx, 10.0f * sy)
            lineTo(12.0f * sx, 10.0f * sy)
            lineTo(12.0f * sx, 14.26f * sy)
            lineTo(17.92f * sx, 14.26f * sy)
            cubicTo(17.66f * sx, 15.63f * sy, 16.88f * sx, 16.79f * sy, 15.71f * sx, 17.57f * sy)
            lineTo(15.71f * sx, 20.34f * sy)
            lineTo(19.28f * sx, 20.34f * sy)
            cubicTo(21.36f * sx, 18.42f * sy, 22.56f * sx, 15.60f * sy, 22.56f * sx, 12.25f * sy)
            close()
        }
        drawPath(blue, Color(0xFF4285F4))

        val green = Path().apply {
            moveTo(12.0f * sx, 23.0f * sy)
            cubicTo(14.97f * sx, 23.0f * sy, 17.46f * sx, 22.02f * sy, 19.28f * sx, 20.34f * sy)
            lineTo(15.71f * sx, 17.57f * sy)
            cubicTo(14.73f * sx, 18.23f * sy, 13.48f * sx, 18.63f * sy, 12.0f * sx, 18.63f * sy)
            cubicTo(9.14f * sx, 18.63f * sy, 6.71f * sx, 16.70f * sy, 5.84f * sx, 14.10f * sy)
            lineTo(2.18f * sx, 14.10f * sy)
            lineTo(2.18f * sx, 16.94f * sy)
            cubicTo(3.99f * sx, 20.53f * sy, 7.70f * sx, 23.0f * sy, 12.0f * sx, 23.0f * sy)
            close()
        }
        drawPath(green, Color(0xFF34A853))

        val yellow = Path().apply {
            moveTo(5.84f * sx, 14.09f * sy)
            cubicTo(5.62f * sx, 13.43f * sy, 5.49f * sx, 12.73f * sy, 5.49f * sx, 12.0f * sy)
            cubicTo(5.49f * sx, 11.27f * sy, 5.62f * sx, 10.57f * sy, 5.84f * sx, 9.91f * sy)
            lineTo(5.84f * sx, 7.07f * sy)
            lineTo(2.18f * sx, 7.07f * sy)
            cubicTo(1.43f * sx, 8.55f * sy, 1.0f * sx, 10.22f * sy, 1.0f * sx, 12.0f * sy)
            cubicTo(1.0f * sx, 13.78f * sy, 1.43f * sx, 15.45f * sy, 2.18f * sx, 16.93f * sy)
            lineTo(5.84f * sx, 14.09f * sy)
            close()
        }
        drawPath(yellow, Color(0xFFFBBC05))

        val red = Path().apply {
            moveTo(12.0f * sx, 5.38f * sy)
            cubicTo(13.62f * sx, 5.38f * sy, 15.06f * sx, 5.94f * sy, 16.21f * sx, 7.02f * sy)
            lineTo(19.36f * sx, 3.87f * sy)
            cubicTo(17.45f * sx, 2.09f * sy, 14.97f * sx, 1.0f * sy, 12.0f * sx, 1.0f * sy)
            cubicTo(7.70f * sx, 1.0f * sy, 3.99f * sx, 3.47f * sy, 2.18f * sx, 7.07f * sy)
            lineTo(5.84f * sx, 9.91f * sy)
            cubicTo(6.71f * sx, 7.31f * sy, 9.14f * sx, 5.38f * sy, 12.0f * sx, 5.38f * sy)
            close()
        }
        drawPath(red, Color(0xFFEA4335))
    }
}

@Composable
private fun GitHubMarkCanvas(
    tint: Color,
    modifier: Modifier = Modifier,
) {
    Canvas(modifier = modifier) {
        val sx = size.width / 24f
        val sy = size.height / 24f
        val mark = Path().apply {
            moveTo(12.0f * sx, 0.5f * sy)
            cubicTo(5.65f * sx, 0.5f * sy, 0.5f * sx, 5.65f * sy, 0.5f * sx, 12.0f * sy)
            cubicTo(0.5f * sx, 17.09f * sy, 3.79f * sx, 21.40f * sy, 8.36f * sx, 22.92f * sy)
            cubicTo(8.94f * sx, 23.03f * sy, 9.15f * sx, 22.67f * sy, 9.15f * sx, 22.36f * sy)
            cubicTo(9.15f * sx, 22.09f * sy, 9.14f * sx, 21.17f * sy, 9.13f * sx, 20.20f * sy)
            cubicTo(5.93f * sx, 20.90f * sy, 5.26f * sx, 18.85f * sy, 5.26f * sx, 18.85f * sy)
            cubicTo(4.74f * sx, 17.52f * sy, 3.98f * sx, 17.17f * sy, 3.98f * sx, 17.17f * sy)
            cubicTo(2.94f * sx, 16.46f * sy, 4.06f * sx, 16.47f * sy, 4.06f * sx, 16.47f * sy)
            cubicTo(5.21f * sx, 16.55f * sy, 5.82f * sx, 17.65f * sy, 5.82f * sx, 17.65f * sy)
            cubicTo(6.84f * sx, 19.41f * sy, 8.50f * sx, 18.90f * sy, 9.16f * sx, 18.60f * sy)
            cubicTo(9.26f * sx, 17.86f * sy, 9.56f * sx, 17.35f * sy, 9.89f * sx, 17.07f * sy)
            cubicTo(7.34f * sx, 16.78f * sy, 4.65f * sx, 15.79f * sy, 4.65f * sx, 11.39f * sy)
            cubicTo(4.65f * sx, 10.13f * sy, 5.10f * sx, 9.11f * sy, 5.84f * sx, 8.30f * sy)
            cubicTo(5.72f * sx, 8.01f * sy, 5.32f * sx, 6.84f * sy, 5.95f * sx, 5.26f * sy)
            cubicTo(5.95f * sx, 5.26f * sy, 6.92f * sx, 4.95f * sy, 9.12f * sx, 6.44f * sy)
            cubicTo(10.04f * sx, 6.18f * sy, 11.02f * sx, 6.05f * sy, 12.0f * sx, 6.05f * sy)
            cubicTo(12.98f * sx, 6.05f * sy, 13.96f * sx, 6.18f * sy, 14.88f * sx, 6.44f * sy)
            cubicTo(17.08f * sx, 4.95f * sy, 18.05f * sx, 5.26f * sy, 18.05f * sx, 5.26f * sy)
            cubicTo(18.68f * sx, 6.84f * sy, 18.28f * sx, 8.01f * sy, 18.16f * sx, 8.30f * sy)
            cubicTo(18.90f * sx, 9.11f * sy, 19.35f * sx, 10.13f * sy, 19.35f * sx, 11.39f * sy)
            cubicTo(19.35f * sx, 15.80f * sy, 16.65f * sx, 16.77f * sy, 14.09f * sx, 17.06f * sy)
            cubicTo(14.50f * sx, 17.42f * sy, 14.87f * sx, 18.12f * sy, 14.87f * sx, 19.20f * sy)
            cubicTo(14.87f * sx, 20.75f * sx, 14.86f * sx, 21.99f * sy, 14.86f * sx, 22.36f * sy)
            cubicTo(14.86f * sx, 22.67f * sy, 15.07f * sx, 23.04f * sy, 15.65f * sx, 22.92f * sy)
            cubicTo(20.21f * sx, 21.39f * sy, 23.5f * sx, 17.08f * sy, 23.5f * sx, 12.0f * sy)
            cubicTo(23.5f * sx, 5.65f * sy, 18.35f * sx, 0.5f * sy, 12.0f * sx, 0.5f * sy)
            close()
        }
        drawPath(mark, tint)
    }
}
