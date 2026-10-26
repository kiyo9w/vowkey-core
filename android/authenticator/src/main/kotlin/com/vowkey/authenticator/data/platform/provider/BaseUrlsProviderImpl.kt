package com.vowkey.authenticator.data.platform.provider

import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.data.repository.model.Environment
import com.vowkey.data.repository.util.baseApiUrl
import com.vowkey.data.repository.util.baseEventsUrl
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.network.interceptor.BaseUrlsProvider

/**
 * Default implementation of [BaseUrlsProvider].
 */
@OmitFromCoverage
object BaseUrlsProviderImpl : BaseUrlsProvider {
    override fun getBaseApiUrl(): String = Environment.Prod.Us.baseApiUrl
    override fun getBaseIdentityUrl(): String = Environment.Prod.Us.baseIdentityUrl
    override fun getBaseEventsUrl(): String = Environment.Prod.Us.baseEventsUrl
    override fun getBaseFillAssistUrl(): String? = null
}
