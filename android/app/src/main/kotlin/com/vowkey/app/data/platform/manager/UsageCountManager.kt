package com.vowkey.app.data.platform.manager

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.network.model.CountJson
import com.vowkey.network.service.EventService
import com.vowkey.app.data.platform.repository.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Posts allowlisted numeric counts. Nothing leaves the device while the switch is off.
 */
@Singleton
class UsageCountManager @Inject constructor(
    private val settingsRepository: SettingsRepository,
    private val eventService: EventService,
    dispatcherManager: DispatcherManager,
) {
    private val scope = CoroutineScope(dispatcherManager.io)

    fun appOpened() = send(event = "page_view", page = "home", count = 1)

    fun fillOutcome(filled: Int, close: Int, left: Int) = send(
        event = "fill_outcome",
        page = "$filled:$close:$left",
        count = 1,
    )

    private fun send(event: String, page: String, count: Int) {
        if (!settingsRepository.shareUsageCounts) return
        val body = CountJson(
            event = event,
            surface = "android",
            os = "android",
            locale = Locale.getDefault().toLanguageTag().allowlisted(),
            page = page,
            count = count,
        )
        scope.launch { eventService.sendCount(body) }
    }

}

private val LOCALES = setOf("en", "vi", "ja", "ko", "zh-CN", "zh-TW", "es", "fr", "de", "pt-BR")

private fun String.allowlisted(): String = when {
    this in LOCALES -> this
    startsWith("zh-TW") || startsWith("zh-Hant") -> "zh-TW"
    startsWith("zh") -> "zh-CN"
    startsWith("pt") -> "pt-BR"
    else -> substringBefore('-').takeIf { it in LOCALES } ?: "en"
}
