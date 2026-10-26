package com.vowkey.app.data.platform.manager.provider

import com.vowkey.data.repository.model.Environment
import com.vowkey.app.data.platform.datasource.disk.FakeEnvironmentDiskSource
import com.vowkey.app.data.platform.provider.BaseUrlsProviderImpl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Test

class BaseUrlsProviderTest {

    private val fakeEnvironmentDiskSource = FakeEnvironmentDiskSource()
    private val baseUrlsManager = BaseUrlsProviderImpl(
        environmentDiskSource = fakeEnvironmentDiskSource,
    )

    @Test
    fun `getBaseApiUrl should return correct api URL when preAuthEnvironmentUrlData is set`() {
        fakeEnvironmentDiskSource.preAuthEnvironmentUrlData = Environment.Prod.Eu.environmentUrlData
        assertEquals(
            "https://api.vowkey.eu",
            baseUrlsManager.getBaseApiUrl(),
        )
    }

    @Test
    fun `getBaseApiUrl should return default value when preAuthEnvironmentUrlData is null`() {
        fakeEnvironmentDiskSource.preAuthEnvironmentUrlData = null
        assertEquals(
            "https://api.vowkey.com",
            baseUrlsManager.getBaseApiUrl(),
        )
    }

    @Test
    fun `getBaseIdentityUrl should return correct api URL when preAuthEnvironmentUrlData is set`() {
        fakeEnvironmentDiskSource.preAuthEnvironmentUrlData = Environment.Prod.Eu.environmentUrlData
        assertEquals(
            "https://identity.vowkey.eu",
            baseUrlsManager.getBaseIdentityUrl(),
        )
    }

    @Test
    fun `getBaseIdentityUrl should return default value when preAuthEnvironmentUrlData is null`() {
        fakeEnvironmentDiskSource.preAuthEnvironmentUrlData = null
        assertEquals(
            "https://identity.vowkey.com",
            baseUrlsManager.getBaseIdentityUrl(),
        )
    }

    @Test
    fun `getBaseEventsUrl should return correct api URL when preAuthEnvironmentUrlData is set`() {
        fakeEnvironmentDiskSource.preAuthEnvironmentUrlData = Environment.Prod.Eu.environmentUrlData
        assertEquals(
            "https://events.vowkey.eu",
            baseUrlsManager.getBaseEventsUrl(),
        )
    }

    @Test
    fun `getBaseEventsUrl should return default value when preAuthEnvironmentUrlData is null`() {
        fakeEnvironmentDiskSource.preAuthEnvironmentUrlData = null
        assertEquals(
            "https://events.vowkey.com",
            baseUrlsManager.getBaseEventsUrl(),
        )
    }

    @Test
    fun `getBaseFillAssistUrl should return url from disk source when present`() {
        fakeEnvironmentDiskSource.fillAssistRulesUrl = "https://example.com/"
        assertEquals("https://example.com/", baseUrlsManager.getBaseFillAssistUrl())
    }

    @Test
    fun `getBaseFillAssistUrl should return null when not set`() {
        fakeEnvironmentDiskSource.fillAssistRulesUrl = null
        assertNull(baseUrlsManager.getBaseFillAssistUrl())
    }
}
