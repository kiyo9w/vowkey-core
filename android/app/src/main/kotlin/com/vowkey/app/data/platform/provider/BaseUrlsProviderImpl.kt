package com.vowkey.app.data.platform.provider

import com.vowkey.data.repository.util.baseApiUrl
import com.vowkey.data.repository.util.baseEventsUrl
import com.vowkey.data.repository.util.baseIdentityUrl
import com.vowkey.data.repository.util.toEnvironmentUrlsOrDefault
import com.vowkey.network.interceptor.BaseUrlsProvider
import com.vowkey.app.data.platform.datasource.disk.EnvironmentDiskSource

/**
 * The default implementation of [BaseUrlsProvider].
 */
class BaseUrlsProviderImpl(
    private val environmentDiskSource: EnvironmentDiskSource,
) : BaseUrlsProvider {

    override fun getBaseApiUrl(): String = environmentDiskSource
        .preAuthEnvironmentUrlData
        .toEnvironmentUrlsOrDefault()
        .baseApiUrl

    override fun getBaseIdentityUrl(): String = environmentDiskSource
        .preAuthEnvironmentUrlData
        .toEnvironmentUrlsOrDefault()
        .baseIdentityUrl

    override fun getBaseEventsUrl(): String = environmentDiskSource
        .preAuthEnvironmentUrlData
        .toEnvironmentUrlsOrDefault()
        .baseEventsUrl

    override fun getBaseFillAssistUrl(): String? = environmentDiskSource.fillAssistRulesUrl
}
