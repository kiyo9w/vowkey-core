@file:Suppress("TooManyFunctions")

package com.vowkey.app.ui.platform.feature.premium.plan

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberTopAppBarState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.paint
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.hideFromAccessibility
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.hilt.lifecycle.viewmodel.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.ui.platform.base.util.EventsEffect
import com.vowkey.ui.platform.base.util.annotatedPluralsResource
import com.vowkey.ui.platform.base.util.annotatedStringResource
import com.vowkey.ui.platform.base.util.cardStyle
import com.vowkey.ui.platform.base.util.spanStyleOf
import com.vowkey.ui.platform.base.util.standardHorizontalMargin
import com.vowkey.ui.platform.components.appbar.VowkeyTopAppBar
import com.vowkey.ui.platform.components.badge.VowkeyStatusBadge
import com.vowkey.ui.platform.components.button.VowkeyFilledButton
import com.vowkey.ui.platform.components.button.VowkeyOutlinedButton
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.components.card.VowkeyInfoCalloutCard
import com.vowkey.ui.platform.components.content.VowkeyContentBlock
import com.vowkey.ui.platform.components.content.VowkeyErrorContent
import com.vowkey.ui.platform.components.content.VowkeyLoadingContent
import com.vowkey.ui.platform.components.content.model.ContentBlockData
import com.vowkey.ui.platform.components.dialog.VowkeyLoadingDialog
import com.vowkey.ui.platform.components.dialog.VowkeyTwoButtonDialog
import com.vowkey.ui.platform.components.divider.VowkeyHorizontalDivider
import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.platform.components.model.CardStyle
import com.vowkey.ui.platform.components.scaffold.VowkeyScaffold
import com.vowkey.ui.platform.components.util.rememberVectorPainter
import com.vowkey.ui.platform.composition.LocalIntentManager
import com.vowkey.ui.platform.manager.IntentManager
import com.vowkey.ui.platform.manager.intent.model.AuthTabData
import com.vowkey.ui.platform.resource.VowkeyDrawable
import com.vowkey.ui.platform.resource.VowkeyPlurals
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.Text
import com.vowkey.ui.util.asText
import com.vowkey.app.data.billing.repository.model.PremiumSubscriptionStatus
import com.vowkey.app.ui.platform.composition.LocalAuthTabLaunchers
import com.vowkey.app.ui.platform.feature.premium.plan.PlanState.ViewState.Error.Type.PRICING_UNAVAILABLE
import com.vowkey.app.ui.platform.feature.premium.plan.PlanState.ViewState.Error.Type.SUBSCRIPTION
import com.vowkey.app.ui.platform.feature.premium.plan.handlers.PlanHandlers
import com.vowkey.app.ui.platform.feature.premium.plan.util.badgeColors
import com.vowkey.app.ui.platform.feature.premium.plan.util.labelRes
import com.vowkey.app.ui.platform.feature.premium.plan.util.showsFeatureList
import com.vowkey.app.ui.platform.model.AuthTabLaunchers
import kotlinx.collections.immutable.ImmutableList
import kotlinx.collections.immutable.persistentListOf

private const val PLACEHOLDER_TEXT: String = "--"

/**
 * The screen for the plan — shows the upgrade flow for free users and the
 * subscription-management surface for premium users.
 */
@Suppress("LongMethod")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanScreen(
    onNavigateBack: () -> Unit,
    onNavigateToUpgradedToPremium: () -> Unit,
    viewModel: PlanViewModel = hiltViewModel(),
    intentManager: IntentManager = LocalIntentManager.current,
    authTabLaunchers: AuthTabLaunchers = LocalAuthTabLaunchers.current,
) {
    val state by viewModel.stateFlow.collectAsStateWithLifecycle()
    val handlers = remember(viewModel) { PlanHandlers.create(viewModel) }

    EventsEffect(viewModel = viewModel) { event ->
        when (event) {
            is PlanEvent.LaunchBrowser -> {
                intentManager.startAuthTab(
                    uri = event.url.toUri(),
                    authTabData = event.authTabData,
                    launcher = authTabLaunchers.premiumCheckout,
                )
            }

            is PlanEvent.LaunchPortal -> {
                intentManager.startAuthTab(
                    uri = event.url.toUri(),
                    authTabData = AuthTabData.CustomScheme(
                        callbackUrl = PREMIUM_CHECKOUT_CALLBACK_URL,
                    ),
                    launcher = authTabLaunchers.stripePortal,
                )
            }

            is PlanEvent.LaunchUri -> intentManager.launchUri(event.url.toUri())
            PlanEvent.NavigateBack -> onNavigateBack()
            PlanEvent.NavigateToUpgradedToPremium -> onNavigateToUpgradedToPremium()
        }
    }

    PlanDialogs(
        dialogState = state.dialogState,
        handlers = handlers,
    )

    val scrollBehavior = TopAppBarDefaults.pinnedScrollBehavior(rememberTopAppBarState())
    VowkeyScaffold(
        modifier = Modifier
            .fillMaxSize()
            .nestedScroll(scrollBehavior.nestedScrollConnection),
        topBar = {
            VowkeyTopAppBar(
                title = stringResource(id = state.title),
                scrollBehavior = scrollBehavior,
                navigationIcon = rememberVectorPainter(id = state.navigationIcon),
                navigationIconContentDescription = stringResource(
                    id = state.navigationIconContentDescription,
                ),
                onNavigationIconClick = handlers.onBackClick,
            )
        },
    ) {
        when (val viewState = state.viewState) {
            is PlanState.ViewState.Content.Free.Cloud -> {
                FreeCloudContent(
                    viewState = viewState,
                    handlers = handlers,
                )
            }

            is PlanState.ViewState.Content.Free.SelfHosted -> {
                FreeSelfHostedContent()
            }

            is PlanState.ViewState.Content.Premium -> {
                PremiumContent(
                    viewState = viewState,
                    handlers = handlers,
                )
            }

            is PlanState.ViewState.Error -> {
                VowkeyErrorContent(
                    illustrationData = IconData.Local(iconRes = VowkeyDrawable.ill_file_error),
                    message = viewState.message(),
                    buttonData = VowkeyButtonData(
                        label = VowkeyString.try_again.asText(),
                        onClick = {
                            when (viewState.type) {
                                PRICING_UNAVAILABLE -> handlers.onRetryPricingClick()
                                SUBSCRIPTION -> handlers.onRetrySubscriptionClick()
                            }
                        },
                    ),
                    modifier = Modifier.fillMaxSize(),
                )
            }

            is PlanState.ViewState.Loading -> {
                VowkeyLoadingContent(
                    text = viewState.message(),
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

@Suppress("LongMethod")
@Composable
private fun PlanDialogs(
    dialogState: PlanState.DialogState?,
    handlers: PlanHandlers,
) {
    when (dialogState) {
        is PlanState.DialogState.CheckoutError -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.secure_checkout_didnt_load),
                message = stringResource(id = VowkeyString.trouble_opening_payment_page),
                confirmButtonText = stringResource(id = VowkeyString.try_again),
                dismissButtonText = stringResource(id = VowkeyString.close),
                onConfirmClick = handlers.onRetryClick,
                onDismissClick = handlers.onDismissError,
                onDismissRequest = handlers.onDismissError,
            )
        }

        is PlanState.DialogState.WaitingForPayment -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.payment_not_received_yet),
                message = stringResource(id = VowkeyString.return_to_stripe_to_finish),
                confirmButtonText = stringResource(id = VowkeyString.go_back),
                dismissButtonText = stringResource(id = VowkeyString.close),
                onConfirmClick = handlers.onGoBackClick,
                onDismissClick = handlers.onCancelWaiting,
                onDismissRequest = handlers.onCancelWaiting,
            )
        }

        is PlanState.DialogState.PendingUpgrade -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.upgrade_pending),
                message = stringResource(
                    id = VowkeyString.upgrade_pending_message,
                ),
                confirmButtonText = stringResource(id = VowkeyString.sync_now),
                dismissButtonText = stringResource(id = VowkeyString.continue_text),
                onConfirmClick = handlers.onSyncClick,
                onDismissClick = handlers.onContinueClick,
                onDismissRequest = handlers.onContinueClick,
            )
        }

        is PlanState.DialogState.CancelConfirmation -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.continue_to_stripe),
                message = stringResource(
                    id = VowkeyString
                        .youll_be_taken_to_stripe_to_manage_your_subscription_cancellation,
                    dialogState.nextRenewalDate,
                ),
                confirmButtonText = stringResource(id = VowkeyString.continue_text),
                dismissButtonText = stringResource(id = VowkeyString.cancel),
                onConfirmClick = handlers.onConfirmCancelClick,
                onDismissClick = handlers.onDismissCancelConfirmation,
                onDismissRequest = handlers.onDismissCancelConfirmation,
            )
        }

        is PlanState.DialogState.PortalError -> {
            VowkeyTwoButtonDialog(
                title = stringResource(id = VowkeyString.portal_error),
                message = stringResource(id = VowkeyString.trouble_loading_portal),
                confirmButtonText = stringResource(id = VowkeyString.try_again),
                dismissButtonText = stringResource(id = VowkeyString.close),
                onConfirmClick = handlers.onRetryPortalClick,
                onDismissClick = handlers.onDismissPortalError,
                onDismissRequest = handlers.onDismissPortalError,
            )
        }

        PlanState.DialogState.LoadingPortal -> {
            VowkeyLoadingDialog(
                text = stringResource(id = VowkeyString.loading_portal),
            )
        }

        is PlanState.DialogState.Loading -> {
            VowkeyLoadingDialog(text = dialogState.message())
        }

        null -> Unit
    }
}

@Composable
private fun FreeCloudContent(
    viewState: PlanState.ViewState.Content.Free.Cloud,
    handlers: PlanHandlers,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(12.dp))
        PremiumDetailsCard(
            modifier = Modifier.standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(height = 16.dp))

        // Hide the Upgrade Now CTA (and its Stripe footer copy) while a Stripe upgrade is
        // already in flight for the active user. CTAs reappear once the server flips the
        // user to Premium.
        if (!viewState.isPremiumUpgradePending) {
            UpgradeNowCallToAction(
                viewState = viewState,
                onUpgradeNowClick = handlers.onUpgradeNowClick,
            )
        }
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun UpgradeNowCallToAction(
    viewState: PlanState.ViewState.Content.Free.Cloud,
    onUpgradeNowClick: () -> Unit,
) {
    VowkeyFilledButton(
        label = stringResource(id = VowkeyString.upgrade_to_premium),
        onClick = onUpgradeNowClick,
        icon = rememberVectorPainter(id = VowkeyDrawable.ic_external_link),
        modifier = Modifier
            .standardHorizontalMargin()
            .fillMaxWidth()
            .testTag("UpgradeNowButton"),
    )
    Spacer(modifier = Modifier.height(height = 12.dp))

    PriceRow(
        rate = viewState.rate,
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )
    Spacer(modifier = Modifier.height(height = 12.dp))

    Text(
        text = stringResource(
            id = VowkeyString.youll_complete_the_purchase_with_stripe_secure_checkout,
        ),
        style = VowkeyTheme.typography.bodyMedium,
        color = VowkeyTheme.colorScheme.text.primary,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin()
            .testTag("StripeFooterText"),
    )
    Spacer(modifier = Modifier.height(height = 16.dp))
}

@Composable
private fun PriceRow(
    rate: String,
    modifier: Modifier = Modifier,
) {
    val formattedContentDescription = stringResource(
        id = VowkeyString.per_month_cancel_anytime_content_description,
        formatArgs = arrayOf(rate),
    )
    Row(
        horizontalArrangement = Arrangement.Center,
        modifier = modifier
            .semantics(mergeDescendants = true) {
                contentDescription = formattedContentDescription
            },
    ) {
        Text(
            text = rate,
            style = VowkeyTheme.typography.labelMedium,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .semantics { hideFromAccessibility() }
                .alignByBaseline(),
        )
        Spacer(modifier = Modifier.width(width = 4.dp))
        Text(
            text = stringResource(id = VowkeyString.per_month_cancel_anytime),
            style = VowkeyTheme.typography.labelSmall,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .semantics { hideFromAccessibility() }
                .alignByBaseline(),
        )
    }
}

@Suppress("MaxLineLength")
@Composable
private fun FreeSelfHostedContent(
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(12.dp))
        VowkeyInfoCalloutCard(
            text = stringResource(
                id = VowkeyString
                    .to_manage_your_premium_subscription_youll_need_to_login_to_your_web_vault_on_a_computer,
            ),
            startIcon = IconData.Local(iconRes = VowkeyDrawable.ic_info_circle),
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth()
                .testTag("SelfHostedManageOnWebVaultCallout"),
        )
        Spacer(modifier = Modifier.height(16.dp))
        PremiumFeaturesCard(
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }
}

@Composable
private fun PremiumFeaturesCard(
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .cardStyle(
                cardStyle = CardStyle.Full,
                // Override bottom padding to account for custom
                // `VowkeyContentBlock` vertical padding, below.
                paddingBottom = 0.dp,
            ),
    ) {
        Text(
            text = stringResource(id = VowkeyString.unlock_premium_features),
            style = VowkeyTheme.typography.labelLarge,
            color = VowkeyTheme.colorScheme.text.primary,
            modifier = Modifier
                .padding(bottom = 16.dp)
                .standardHorizontalMargin(),
        )

        PremiumFeatureRows()
    }
}

@Composable
private fun ColumnScope.PremiumFeatureRows() {
    VowkeyHorizontalDivider()

    val features = listOf(
        VowkeyString.built_in_authenticator,
        VowkeyString.emergency_access,
        VowkeyString.secure_file_storage,
        VowkeyString.breach_monitoring,
    )
    features.forEachIndexed { index, featureStringRes ->
        VowkeyContentBlock(
            data = ContentBlockData(
                headerText = stringResource(id = featureStringRes),
                iconVectorResource = VowkeyDrawable.ic_check_mark,
            ),
            headerTextStyle = VowkeyTheme.typography.titleMedium,
            showDivider = index != features.lastIndex,
            modifier = Modifier
                .defaultMinSize(minHeight = 60.dp)
                .padding(vertical = 8.dp),
        )
    }
}

@Composable
private fun PremiumDetailsCard(
    modifier: Modifier = Modifier,
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
            .fillMaxWidth()
            .run {
                if (VowkeyTheme.colorScheme.isDynamicTheme) {
                    cardStyle(cardStyle = CardStyle.Full, paddingVertical = 0.dp)
                } else {
                    paint(
                        painter = painterResource(id = VowkeyDrawable.bg_card_gradient),
                        contentScale = ContentScale.FillBounds,
                    )
                }
            },
    ) {
        Spacer(modifier = Modifier.height(height = 8.dp))
        Image(
            painter = painterResource(id = VowkeyDrawable.img_premium),
            contentDescription = null,
            modifier = Modifier
                .padding(horizontal = 16.dp)
                .fillMaxWidth(),
        )
        Spacer(modifier = Modifier.height(height = 8.dp))
        Text(
            text = stringResource(id = VowkeyString.unlock_advanced_protection),
            style = VowkeyTheme.typography.headlineSmall,
            color = VowkeyTheme.colorScheme.text.primary,
            textAlign = TextAlign.Center,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 12.dp))
        Benefits(modifier = Modifier.standardHorizontalMargin())
        Spacer(modifier = Modifier.height(height = 4.dp))
    }
}

@Composable
private fun Benefits(
    modifier: Modifier = Modifier,
    benefits: ImmutableList<Text> = persistentListOf(
        VowkeyString.breeze_through_2fa_with_built_in_codes.asText(),
        VowkeyString.run_reports_to_find_risky_passwords.asText(),
        VowkeyString.keep_documents_safe_and_encrypted.asText(),
        VowkeyString.add_a_trusted_emergency_contact.asText(),
        VowkeyString.identify_unsecure_websites.asText(),
        VowkeyString.flag_accounts_with_inactive_2fa.asText(),
        VowkeyString.share_files_securely_with_anyone_using_send.asText(),
        VowkeyString.receive_24_7_priority_support.asText(),
    ),
) {
    Column(modifier = Modifier.width(intrinsicSize = IntrinsicSize.Max)) {
        benefits.forEach {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = modifier,
            ) {
                Icon(
                    painter = rememberVectorPainter(id = VowkeyDrawable.ic_checkmark_small),
                    contentDescription = null,
                    tint = VowkeyTheme.colorScheme.icon.secondary,
                )
                Spacer(modifier = Modifier.width(width = 8.dp))
                Text(
                    text = it(),
                    style = VowkeyTheme.typography.bodyMedium,
                    color = VowkeyTheme.colorScheme.text.primary,
                )
            }
            Spacer(modifier = Modifier.height(height = 12.dp))
        }
    }
}

@Composable
private fun PremiumContent(
    viewState: PlanState.ViewState.Content.Premium,
    handlers: PlanHandlers,
    modifier: Modifier = Modifier,
) {
    var shouldShowManagePlanDialog by rememberSaveable { mutableStateOf(false) }
    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState()),
    ) {
        Spacer(modifier = Modifier.height(12.dp))
        SubscriptionCard(
            viewState = viewState,
            modifier = Modifier.standardHorizontalMargin(),
        )

        Spacer(modifier = Modifier.height(24.dp))

        VowkeyFilledButton(
            label = stringResource(id = VowkeyString.manage_plan),
            onClick = { shouldShowManagePlanDialog = true },
            icon = rememberVectorPainter(id = VowkeyDrawable.ic_external_link),
            isExternalLink = true,
            modifier = Modifier
                .standardHorizontalMargin()
                .fillMaxWidth()
                .testTag("ManagePlanButton"),
        )

        if (viewState.showCancelButton) {
            Spacer(modifier = Modifier.height(12.dp))
            VowkeyOutlinedButton(
                label = stringResource(id = VowkeyString.cancel_premium),
                onClick = handlers.onCancelPremiumClick,
                icon = rememberVectorPainter(id = VowkeyDrawable.ic_external_link),
                isExternalLink = true,
                modifier = Modifier
                    .standardHorizontalMargin()
                    .fillMaxWidth()
                    .testTag("CancelPremiumButton"),
            )
        }

        Spacer(modifier = Modifier.height(16.dp))
        Spacer(modifier = Modifier.navigationBarsPadding())
    }

    if (shouldShowManagePlanDialog) {
        VowkeyTwoButtonDialog(
            title = stringResource(id = VowkeyString.continue_to_web_app),
            message = stringResource(
                id = VowkeyString.manage_your_subscription_plan_in_the_vowkey_web_app,
            ),
            confirmButtonText = stringResource(id = VowkeyString.continue_text),
            dismissButtonText = stringResource(id = VowkeyString.cancel),
            onConfirmClick = {
                shouldShowManagePlanDialog = false
                handlers.onManagePlanClick()
            },
            onDismissClick = { shouldShowManagePlanDialog = false },
            onDismissRequest = { shouldShowManagePlanDialog = false },
        )
    }
}

@Composable
private fun SubscriptionCard(
    viewState: PlanState.ViewState.Content.Premium,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .cardStyle(
                cardStyle = CardStyle.Full,
                // Override bottom padding; the final row (line item or feature) owns its
                // own spacing.
                paddingBottom = 0.dp,
            ),
    ) {
        SubscriptionHeader(
            status = viewState.status,
            nextChargeTotalText = viewState.nextChargeTotalText,
            nextChargeDateText = viewState.nextChargeDateText,
            cancelAtDateText = viewState.cancelAtDateText,
            canceledDateText = viewState.canceledDateText,
            suspensionDateText = viewState.suspensionDateText,
            gracePeriodDays = viewState.gracePeriodDays,
            modifier = Modifier.standardHorizontalMargin(),
        )
        Spacer(modifier = Modifier.height(height = 16.dp))

        if (viewState.status?.showsFeatureList() == true) {
            PremiumFeatureRows()
        } else {
            SubscriptionLineItems(viewState = viewState)
        }
    }
}

@Composable
private fun ColumnScope.SubscriptionLineItems(
    viewState: PlanState.ViewState.Content.Premium,
) {
    VowkeyHorizontalDivider()
    SubscriptionLineItem(
        label = stringResource(id = VowkeyString.billing_amount),
        value = viewState.billingAmountText(),
        testTag = "BillingAmountRow",
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )

    viewState.storageCostText?.let { storageCostText ->
        VowkeyHorizontalDivider(modifier = Modifier.padding(start = 16.dp))
        SubscriptionLineItem(
            label = stringResource(id = VowkeyString.storage_cost),
            value = storageCostText,
            testTag = "StorageCostRow",
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }

    viewState.discountAmountText?.let { discountAmountText ->
        VowkeyHorizontalDivider(modifier = Modifier.padding(start = 16.dp))
        SubscriptionLineItem(
            label = stringResource(id = VowkeyString.discount),
            value = discountAmountText,
            testTag = "DiscountRow",
            valueColor = VowkeyTheme.colorScheme.statusBadge.success.text,
            modifier = Modifier
                .fillMaxWidth()
                .standardHorizontalMargin(),
        )
    }

    VowkeyHorizontalDivider(modifier = Modifier.padding(start = 16.dp))
    SubscriptionLineItem(
        label = stringResource(id = VowkeyString.estimated_tax),
        value = viewState.estimatedTaxText,
        testTag = "EstimatedTaxRow",
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )

    VowkeyHorizontalDivider(modifier = Modifier.padding(start = 16.dp))
    SubscriptionLineItem(
        label = stringResource(id = VowkeyString.total),
        value = viewState.totalText(),
        testTag = "TotalRow",
        labelStyle = VowkeyTheme.typography.bodyLargeEmphasis,
        modifier = Modifier
            .fillMaxWidth()
            .standardHorizontalMargin(),
    )
}

@Composable
private fun SubscriptionHeader(
    status: PremiumSubscriptionStatus?,
    nextChargeTotalText: String?,
    nextChargeDateText: String?,
    cancelAtDateText: String?,
    canceledDateText: String?,
    suspensionDateText: String?,
    gracePeriodDays: Int?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                text = stringResource(id = VowkeyString.premium_plan_name),
                style = VowkeyTheme.typography.titleExtraLarge,
                color = VowkeyTheme.colorScheme.text.primary,
            )
            status?.let {
                Spacer(modifier = Modifier.width(8.dp))
                VowkeyStatusBadge(
                    label = stringResource(id = it.labelRes()),
                    colors = it.badgeColors(),
                )
            }
        }

        val descriptionText = subscriptionDescriptionText(
            status = status,
            nextChargeTotalText = nextChargeTotalText,
            nextChargeDateText = nextChargeDateText,
            cancelAtDateText = cancelAtDateText,
            canceledDateText = canceledDateText,
            suspensionDateText = suspensionDateText,
            gracePeriodDays = gracePeriodDays,
        )

        descriptionText?.let {
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = it,
                style = VowkeyTheme.typography.labelLargeRegular,
                color = VowkeyTheme.colorScheme.text.secondary,
            )
        }
    }
}

@Suppress("CyclomaticComplexMethod", "LongMethod")
@Composable
private fun subscriptionDescriptionText(
    status: PremiumSubscriptionStatus?,
    nextChargeTotalText: String?,
    nextChargeDateText: String?,
    cancelAtDateText: String?,
    canceledDateText: String?,
    suspensionDateText: String?,
    gracePeriodDays: Int?,
): AnnotatedString? {
    val baseStyle = spanStyleOf(
        color = VowkeyTheme.colorScheme.text.secondary,
        textStyle = VowkeyTheme.typography.labelLargeRegular,
    )
    val emphasisStyle = spanStyleOf(
        color = VowkeyTheme.colorScheme.text.secondary,
        textStyle = VowkeyTheme.typography.labelLargeEmphasis,
    )
    return when (status) {
        PremiumSubscriptionStatus.ACTIVE -> annotatedStringResource(
            id = VowkeyString.premium_next_charge_summary,
            args = arrayOf(
                nextChargeTotalText ?: PLACEHOLDER_TEXT,
                nextChargeDateText ?: PLACEHOLDER_TEXT,
            ),
            style = baseStyle,
            emphasisHighlightStyle = emphasisStyle,
        )

        PremiumSubscriptionStatus.CANCELED -> annotatedStringResource(
            id = VowkeyString.subscription_canceled_description,
            args = arrayOf(canceledDateText ?: suspensionDateText ?: PLACEHOLDER_TEXT),
            style = baseStyle,
            emphasisHighlightStyle = emphasisStyle,
        )

        PremiumSubscriptionStatus.PENDING_CANCELLATION -> annotatedStringResource(
            id = VowkeyString.subscription_pending_cancellation_description,
            args = arrayOf(cancelAtDateText ?: PLACEHOLDER_TEXT),
            style = baseStyle,
            emphasisHighlightStyle = emphasisStyle,
        )

        PremiumSubscriptionStatus.UNPAID -> annotatedStringResource(
            id = VowkeyString.subscription_unpaid_description,
            args = arrayOf(suspensionDateText ?: PLACEHOLDER_TEXT),
            style = baseStyle,
            emphasisHighlightStyle = emphasisStyle,
        )

        PremiumSubscriptionStatus.UPDATE_PAYMENT -> annotatedStringResource(
            id = VowkeyString.subscription_update_payment_description,
            args = arrayOf(suspensionDateText ?: PLACEHOLDER_TEXT),
            style = baseStyle,
            emphasisHighlightStyle = emphasisStyle,
        )

        PremiumSubscriptionStatus.PAST_DUE -> {
            val days = gracePeriodDays ?: 0
            annotatedPluralsResource(
                id = VowkeyPlurals.subscription_past_due_description,
                quantity = days,
                days.toString(),
                suspensionDateText ?: PLACEHOLDER_TEXT,
                style = baseStyle,
                emphasisHighlightStyle = emphasisStyle,
            )
        }

        PremiumSubscriptionStatus.PAUSED -> AnnotatedString(
            stringResource(id = VowkeyString.subscription_paused_description),
        )

        PremiumSubscriptionStatus.EXPIRED -> annotatedStringResource(
            id = VowkeyString.subscription_expired_description,
            args = arrayOf(suspensionDateText ?: PLACEHOLDER_TEXT),
            style = baseStyle,
            emphasisHighlightStyle = emphasisStyle,
        )

        null -> null
    }
}

@Composable
private fun SubscriptionLineItem(
    label: String,
    value: String,
    testTag: String,
    modifier: Modifier = Modifier,
    labelStyle: TextStyle = VowkeyTheme.typography.bodyLarge,
    labelColor: Color = VowkeyTheme.colorScheme.text.secondary,
    valueStyle: TextStyle = VowkeyTheme.typography.bodyMedium,
    valueColor: Color = VowkeyTheme.colorScheme.text.primary,
) {
    Row(
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
        modifier = modifier
            .defaultMinSize(minHeight = 60.dp)
            .padding(vertical = 16.dp)
            .testTag(tag = testTag),
    ) {
        Text(
            text = label,
            style = labelStyle,
            color = labelColor,
        )
        Text(
            text = value,
            style = valueStyle,
            color = valueColor,
        )
    }
}

@Preview
@OmitFromCoverage
@Composable
private fun PlanScreenFreeCloudAccount_preview() {
    VowkeyTheme {
        VowkeyScaffold {
            FreeCloudContent(
                viewState = PlanState.ViewState.Content.Free.Cloud(
                    rate = "$1.67",
                    checkoutUrl = null,
                    isAwaitingPremiumStatus = false,
                    isPremiumUpgradePending = false,
                ),
                handlers = PlanHandlers(
                    onBackClick = {},
                    onUpgradeNowClick = {},
                    onDismissError = {},
                    onRetryClick = {},
                    onRetryPricingClick = {},
                    onClosePricingErrorClick = {},
                    onCancelWaiting = {},
                    onGoBackClick = {},
                    onSyncClick = {},
                    onContinueClick = {},
                    onManagePlanClick = {},
                    onCancelPremiumClick = {},
                    onConfirmCancelClick = {},
                    onDismissCancelConfirmation = {},
                    onDismissPortalError = {},
                    onRetryPortalClick = {},
                    onRetrySubscriptionClick = {},
                ),
            )
        }
    }
}

@Preview
@OmitFromCoverage
@Composable
private fun PlanScreenFreeSelfHostedFreeAccount_preview() {
    VowkeyTheme {
        VowkeyScaffold {
            FreeSelfHostedContent()
        }
    }
}

@Preview
@OmitFromCoverage
@Composable
private fun PlanScreenPremiumAccount_preview() {
    VowkeyTheme {
        VowkeyScaffold {
            PremiumContent(
                viewState = PlanState.ViewState.Content.Premium(
                    status = PremiumSubscriptionStatus.ACTIVE,
                    billingAmountText = VowkeyString.billing_rate_per_year.asText("$19.80"),
                    storageCostText = "$24.00",
                    discountAmountText = "-$2.10",
                    estimatedTaxText = "$3.85",
                    totalText = VowkeyString.billing_rate_per_year.asText("$45.55"),
                    nextChargeTotalText = "$45.55",
                    nextChargeDateText = "April 2, 2026",
                    showCancelButton = true,
                ),
                handlers = PlanHandlers(
                    onBackClick = {},
                    onUpgradeNowClick = {},
                    onDismissError = {},
                    onRetryClick = {},
                    onRetryPricingClick = {},
                    onClosePricingErrorClick = {},
                    onCancelWaiting = {},
                    onGoBackClick = {},
                    onSyncClick = {},
                    onContinueClick = {},
                    onManagePlanClick = {},
                    onCancelPremiumClick = {},
                    onConfirmCancelClick = {},
                    onDismissCancelConfirmation = {},
                    onDismissPortalError = {},
                    onRetryPortalClick = {},
                    onRetrySubscriptionClick = {},
                ),
            )
        }
    }
}

@Preview
@OmitFromCoverage
@Composable
private fun PlanScreenPremiumAccountZeroState_preview() {
    VowkeyTheme {
        VowkeyScaffold {
            PremiumContent(
                viewState = PlanState.ViewState.Content.Premium(
                    status = PremiumSubscriptionStatus.ACTIVE,
                    billingAmountText = VowkeyString.billing_rate_per_year.asText("$19.80"),
                    storageCostText = null,
                    discountAmountText = null,
                    estimatedTaxText = "$0.00",
                    totalText = VowkeyString.billing_rate_per_year.asText("$19.80"),
                    nextChargeTotalText = "$19.80",
                    nextChargeDateText = "April 2, 2026",
                    showCancelButton = true,
                ),
                handlers = PlanHandlers(
                    onBackClick = {},
                    onUpgradeNowClick = {},
                    onDismissError = {},
                    onRetryClick = {},
                    onRetryPricingClick = {},
                    onClosePricingErrorClick = {},
                    onCancelWaiting = {},
                    onGoBackClick = {},
                    onSyncClick = {},
                    onContinueClick = {},
                    onManagePlanClick = {},
                    onCancelPremiumClick = {},
                    onConfirmCancelClick = {},
                    onDismissCancelConfirmation = {},
                    onDismissPortalError = {},
                    onRetryPortalClick = {},
                    onRetrySubscriptionClick = {},
                ),
            )
        }
    }
}
