package com.vowkey.network.service

import com.vowkey.network.api.EventApi
import com.vowkey.network.model.CountJson
import com.vowkey.network.model.OrganizationEventJson
import com.vowkey.network.util.toResult

/**
 * The default implementation of the [EventService].
 */
internal class EventServiceImpl(
    private val organizationEventsApi: EventApi,
    private val countsApi: EventApi,
) : EventService {
    override suspend fun sendOrganizationEvents(
        events: List<OrganizationEventJson>,
    ): Result<Unit> = organizationEventsApi.collectOrganizationEvents(events = events).toResult()

    override suspend fun sendCount(count: CountJson): Result<Unit> =
        countsApi.postCount(count = count).toResult()
}
