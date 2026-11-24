package com.vowkey.network.service

import com.vowkey.network.api.AuthenticatedBillingApi
import com.vowkey.network.model.CheckoutSessionRequestJson
import com.vowkey.network.model.CheckoutSessionResponseJson
import com.vowkey.network.model.EntitlementResponseJson
import com.vowkey.network.model.GetSubscriptionResponse
import com.vowkey.network.model.PortalUrlResponseJson
import com.vowkey.network.model.PremiumPlanResponseJson
import com.vowkey.network.model.toVowkeyError
import com.vowkey.network.util.NetworkErrorCode
import com.vowkey.network.util.isErrorCode
import com.vowkey.network.util.toResult

private const val PLATFORM = "android"

/**
 * The default implementation of the [BillingService].
 */
internal class BillingServiceImpl(
    private val authenticatedBillingApi: AuthenticatedBillingApi,
) : BillingService {

    override suspend fun createCheckoutSession(): Result<CheckoutSessionResponseJson> =
        authenticatedBillingApi
            .createCheckoutSession(
                body = CheckoutSessionRequestJson(platform = PLATFORM),
            )
            .toResult()

    override suspend fun getPortalUrl(): Result<PortalUrlResponseJson> =
        authenticatedBillingApi
            .getPortalUrl()
            .toResult()

    override suspend fun getPremiumPlan(): Result<PremiumPlanResponseJson> =
        authenticatedBillingApi
            .getPremiumPlan()
            .toResult()

    override suspend fun getSubscription(): Result<GetSubscriptionResponse> =
        authenticatedBillingApi
            .getSubscription()
            .toResult()
            .map { GetSubscriptionResponse.Success(subscription = it) }
            .recoverCatching { throwable ->
                val vowkeyError = throwable.toVowkeyError()
                if (vowkeyError.isErrorCode(code = NetworkErrorCode.NOT_FOUND)) {
                    GetSubscriptionResponse.NotFound
                } else {
                    throw throwable
                }
            }

    override suspend fun getEntitlement(): Result<EntitlementResponseJson> =
        authenticatedBillingApi.getEntitlement().toResult()

}
