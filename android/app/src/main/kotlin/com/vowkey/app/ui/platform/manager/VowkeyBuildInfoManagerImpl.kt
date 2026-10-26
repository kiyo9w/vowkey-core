package com.vowkey.app.ui.platform.manager

import com.vowkey.annotation.OmitFromCoverage
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.app.BuildConfig

/**
 * Implementation of [BuildInfoManager] for Vowkey Password Manager.
 */
@OmitFromCoverage
class VowkeyBuildInfoManagerImpl : BuildInfoManager {
    override val applicationId: String
        get() = BuildConfig.APPLICATION_ID

    override val applicationName: String get() = "Password Manager"

    override val isFdroid: Boolean
        get() = BuildConfig.FLAVOR == "fdroid"

    override val isDevBuild: Boolean
        get() = BuildConfig.BUILD_TYPE == "debug"

    override val isReleaseBuild: Boolean
        get() = BuildConfig.BUILD_TYPE == "release"

    override val versionData: String
        get() = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    override val sdkData: String
        get() = BuildConfig.SDK_VERSION

    override val ciBuildInfo: String?
        get() = BuildConfig.CI_INFO.takeUnless { it.isBlank() }

    override val buildFlavorName: String
        get() = when (BuildConfig.FLAVOR) {
            "standard" -> ""
            else -> "-${BuildConfig.FLAVOR}"
        }

    override val buildTypeName: String
        get() = when (BuildConfig.BUILD_TYPE) {
            "debug" -> "dev"
            "release" -> "prod"
            else -> BuildConfig.BUILD_TYPE
        }

    override val buildAndFlavor: String get() = "${BuildConfig.BUILD_TYPE}/${BuildConfig.FLAVOR}"
}
