package com.vowkey.app.data.platform.manager

import android.content.Context
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.model.Environment
import com.vowkey.app.BuildConfig
import com.vowkey.app.data.platform.datasource.disk.legacy.LegacyAppCenterMigrator
import com.vowkey.app.data.platform.repository.SettingsRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import io.sentry.Sentry
import io.sentry.SentryEvent
import io.sentry.SentryOptions
import io.sentry.android.core.SentryAndroid
import io.sentry.protocol.Message
import io.sentry.protocol.OperatingSystem
import io.sentry.protocol.SentryException
import io.sentry.protocol.SentryStackFrame
import io.sentry.protocol.SentryStackTrace
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import timber.log.Timber
import javax.inject.Inject

/**
 * Crash reports for standard builds. The SDK stays closed until the person turns the switch on
 * and the server has published a DSN.
 */
@OmitFromCoverage
class LogsManagerImpl @Inject constructor(
    @ApplicationContext private val context: Context,
    private val settingsRepository: SettingsRepository,
    serverConfigRepository: ServerConfigRepository,
    legacyAppCenterMigrator: LegacyAppCenterMigrator,
    dispatcherManager: DispatcherManager,
) : LogsManager {
    private val unconfinedScope = CoroutineScope(dispatcherManager.unconfined)

    private val nonfatalErrorTree: NonfatalErrorTree = NonfatalErrorTree()
    private var activeDsn: String? = null

    override var isEnabled: Boolean
        get() = settingsRepository.isCrashLoggingEnabled
        set(value) {
            settingsRepository.isCrashLoggingEnabled = value
        }

    override fun setUserData(userId: String?, environmentType: Environment.Type) = Unit

    override fun trackNonFatalException(throwable: Throwable) {
        if (Sentry.isEnabled()) Sentry.captureException(throwable)
    }

    init {
        legacyAppCenterMigrator.migrateIfNecessary()
        if (BuildConfig.HAS_LOGS_ENABLED) Timber.plant(Timber.DebugTree())
        combine(
            settingsRepository.isCrashLoggingEnabledFlow,
            serverConfigRepository.serverConfigStateFlow,
        ) { enabled, config ->
            config?.serverData?.crashDsns?.android?.takeIf { enabled && it.isNotBlank() }
        }
            .distinctUntilChanged()
            .onEach(::apply)
            .launchIn(unconfinedScope)
    }

    private fun apply(dsn: String?) {
        if (dsn == null) {
            if (activeDsn != null) {
                if (Timber.forest().contains(nonfatalErrorTree)) Timber.uproot(nonfatalErrorTree)
                Sentry.close()
                activeDsn = null
            }
            return
        }
        if (dsn == activeDsn) return
        SentryAndroid.init(context) { options ->
            options.dsn = dsn
            options.isSendDefaultPii = false
            options.setMaxBreadcrumbs(0)
            options.isEnableAutoSessionTracking = false
            options.tracesSampleRate = null
            options.isAttachScreenshot = false
            options.isAttachViewHierarchy = false
            options.setBeforeSend(SentryOptions.BeforeSendCallback { event, _ -> event.scrubbed() })
        }
        Timber.plant(nonfatalErrorTree)
        activeDsn = dsn
    }

    private inner class NonfatalErrorTree : Timber.Tree() {
        override fun log(priority: Int, tag: String?, message: String, t: Throwable?) {
            t?.let { trackNonFatalException(VowkeyNonfatalException(message.scrubbed(), it)) }
        }
    }
}

private class VowkeyNonfatalException(
    message: String,
    throwable: Throwable,
) : Exception(message, throwable)

private fun SentryEvent.scrubbed(): SentryEvent {
    val keptOs = contexts.operatingSystem?.let { source ->
        OperatingSystem().apply {
            name = source.name?.scrubbed()
            version = source.version?.scrubbed()
        }
    }
    contexts.clear()
    keptOs?.let { contexts.setOperatingSystem(it) }
    setRequest(null)
    setUser(null)
    setBreadcrumbs(emptyList())
    setTags(emptyMap())
    setExtras(emptyMap())
    serverName = null
    transaction = null
    setModules(null)
    fingerprints = null
    message = Message().apply { formatted = exceptions?.firstOrNull()?.type.errorClass() }
    exceptions = exceptions?.map { it.scrubbed() }
    threads = null
    return this
}

private fun SentryException.scrubbed(): SentryException = SentryException().also { copy ->
    copy.type = type.errorClass()
    copy.value = copy.type
    copy.module = module
    copy.stacktrace = stacktrace?.scrubbed()
}

private fun SentryStackTrace.scrubbed(): SentryStackTrace =
    SentryStackTrace(frames?.map { it.scrubbed() })

private fun SentryStackFrame.scrubbed(): SentryStackFrame = SentryStackFrame().also { copy ->
    copy.module = module
    copy.function = function
    copy.lineno = lineno
    copy.colno = colno
    copy.isInApp = isInApp
    copy.setNative(isNative)
    copy.filename = filename?.substringAfterLast('/')?.scrubbed()
}

private fun String?.errorClass(): String = when (this) {
    "NullPointerException", "IllegalArgumentException", "IllegalStateException",
    "IndexOutOfBoundsException", "IOException", "SecurityException", "RuntimeException",
    "Exception", "Error", "OutOfMemoryError", "StackOverflowError", "VowkeyNonfatalException" -> orEmpty()
    else -> "Error"
}

private val DYNAMIC = Regex("""https?://\S+|\b[\w.+-]+@[\w.-]+\.\w+\b""")

private fun String.scrubbed(): String = replace(DYNAMIC, "[filtered]")
