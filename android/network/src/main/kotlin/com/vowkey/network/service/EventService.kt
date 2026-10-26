package com.vowkey.network.service

import com.vowkey.network.model.OrganizationEventJson

/**
 * Provides an API for submitting events.
 */
interface EventService {
    /**
     * Attempts to submit all of the given organizations events.
     */
    suspend fun sendOrganizationEvents(events: List<OrganizationEventJson>): Result<Unit>
}
