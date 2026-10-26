package com.vowkey.app.data.billing.repository

import com.vowkey.network.model.GetSubscriptionResponse
import com.vowkey.network.service.BillingService
import com.vowkey.app.data.billing.manager.PlayBillingManager
import com.vowkey.app.data.billing.repository.model.CheckoutSessionResult
import com.vowkey.app.data.billing.repository.model.CustomerPortalResult
import com.vowkey.app.data.billing.repository.model.PremiumPlanPricingResult
import com.vowkey.app.data.billing.repository.model.SubscriptionResult
import com.vowkey.app.data.billing.repository.util.toSubscriptionInfo
import kotlinx.coroutines.channels.BufferOverflow
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The default implementation of [BillingRepository].
 */
class BillingRepositoryImpl(
    playBillingManager: PlayBillingManager,
    private val billingService: BillingService,
) : BillingRepository {

    private val mutableSubscriptionResultFlow = MutableSharedFlow<SubscriptionResult>(
        extraBufferCapacity = 1,
        onBufferOverflow = BufferOverflow.DROP_OLDEST,
    )

    override val isInAppBillingSupportedFlow: StateFlow<Boolean> =
        playBillingManager.isInAppBillingSupportedFlow

    override suspend fun getCheckoutSessionUrl(): CheckoutSessionResult =
        billingService
            .createCheckoutSession()
            .fold(
                onSuccess = { CheckoutSessionResult.Success(url = it.checkoutSessionUrl) },
                onFailure = { CheckoutSessionResult.Error(error = it) },
            )

    override suspend fun getPortalUrl(): CustomerPortalResult =
        billingService
            .getPortalUrl()
            .fold(
                onSuccess = { CustomerPortalResult.Success(url = it.url) },
                onFailure = { CustomerPortalResult.Error(error = it) },
            )

    override suspend fun getPremiumPlanPricing(): PremiumPlanPricingResult =
        billingService
            .getPremiumPlan()
            .fold(
                onSuccess = {
                    PremiumPlanPricingResult.Success(
                        annualPrice = it.seat.price,
                    )
                },
                onFailure = {
                    PremiumPlanPricingResult.Error(error = it)
                },
            )

    override suspend fun getSubscription(): SubscriptionResult =
        billingService
            .getSubscription()
            .fold(
                onSuccess = { response ->
                    when (response) {
                        is GetSubscriptionResponse.Success -> SubscriptionResult.Success(
                            subscription = response.subscription.toSubscriptionInfo(),
                        )

                        is GetSubscriptionResponse.NotFound -> SubscriptionResult.NotFound
                    }
                },
                onFailure = { SubscriptionResult.Error(error = it) },
            )
            .also { mutableSubscriptionResultFlow.emit(it) }

    override fun getSubscriptionFlow(): Flow<SubscriptionResult> = mutableSubscriptionResultFlow
}
