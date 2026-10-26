package com.vowkey.network.service

import com.vowkey.network.api.EventApi
import com.vowkey.network.model.OrganizationEventJson
import com.vowkey.network.util.toResult

/**
 * The default implementation of the [EventService].
 */
internal class EventServiceImpl(
    private val eventApi: EventApi,
) : EventService {
    override suspend fun sendOrganizationEvents(
        events: List<OrganizationEventJson>,
    ): Result<Unit> = eventApi.collectOrganizationEvents(events = events).toResult()
}
