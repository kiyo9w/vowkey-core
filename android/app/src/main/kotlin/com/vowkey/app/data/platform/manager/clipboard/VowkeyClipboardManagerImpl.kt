package com.vowkey.app.data.platform.manager.clipboard

import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.ui.text.AnnotatedString
import androidx.core.content.getSystemService
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkManager
import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.core.data.manager.toast.ToastManager
import com.vowkey.core.util.isBuildVersionAtLeast
import com.vowkey.ui.platform.base.util.toAnnotatedString
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.Text
import com.vowkey.app.data.platform.repository.SettingsRepository
import java.util.concurrent.TimeUnit

/**
 * Default implementation of the [VowkeyClipboardManager] interface.
 */
@OmitFromCoverage
class VowkeyClipboardManagerImpl(
    private val context: Context,
    private val settingsRepository: SettingsRepository,
    private val toastManager: ToastManager,
) : VowkeyClipboardManager {
    private val clipboardManager: ClipboardManager = requireNotNull(context.getSystemService())

    private val clearClipboardFrequencySeconds: Int?
        get() = settingsRepository.clearClipboardFrequency.frequencySeconds

    override fun setText(
        text: AnnotatedString,
        isSensitive: Boolean,
        toastDescriptorOverride: String?,
    ) {
        clipboardManager.setPrimaryClip(
            ClipData
                .newPlainText("", text)
                .apply {
                    description.extras = PersistableBundle().apply {
                        this.putBoolean(
                            if (isBuildVersionAtLeast(version = Build.VERSION_CODES.TIRAMISU)) {
                                ClipDescription.EXTRA_IS_SENSITIVE
                            } else {
                                "android.content.extra.IS_SENSITIVE"
                            },
                            isSensitive,
                        )
                    }
                },
        )
        if (!isBuildVersionAtLeast(version = Build.VERSION_CODES.TIRAMISU)) {
            val descriptor = toastDescriptorOverride
                ?.let { context.resources.getString(VowkeyString.value_has_been_copied, it) }
                ?: context.resources.getString(
                    VowkeyString.value_has_been_copied,
                    context.resources.getString(VowkeyString.value),
                )
            toastManager.show(message = descriptor)
        }

        val frequency = clearClipboardFrequencySeconds ?: return
        val clearClipboardRequest: OneTimeWorkRequest =
            OneTimeWorkRequest
                .Builder(ClearClipboardWorker::class.java)
                .setInitialDelay(frequency.toLong(), TimeUnit.SECONDS)
                .build()

        WorkManager.getInstance(context).enqueueUniqueWork(
            "ClearClipboard",
            ExistingWorkPolicy.REPLACE,
            clearClipboardRequest,
        )
    }

    override fun setText(text: String, isSensitive: Boolean, toastDescriptorOverride: String?) {
        setText(text.toAnnotatedString(), isSensitive, toastDescriptorOverride)
    }

    override fun setText(text: String, isSensitive: Boolean, toastDescriptorOverride: Text) {
        setText(
            text.toAnnotatedString(),
            isSensitive,
            toastDescriptorOverride.toString(context.resources),
        )
    }

    override fun setText(text: Text, isSensitive: Boolean, toastDescriptorOverride: String?) {
        setText(text.toString(context.resources), isSensitive, toastDescriptorOverride)
    }
}
