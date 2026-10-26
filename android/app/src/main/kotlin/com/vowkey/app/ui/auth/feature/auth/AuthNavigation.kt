package com.vowkey.app.ui.auth.feature.auth

import androidx.navigation.NavController
import androidx.navigation.NavGraphBuilder
import androidx.navigation.NavHostController
import androidx.navigation.NavOptions
import androidx.navigation.navOptions
import androidx.navigation.navigation
import com.vowkey.app.ui.auth.feature.checkemail.checkEmailDestination
import com.vowkey.app.ui.auth.feature.checkemail.navigateToCheckEmail
import com.vowkey.app.ui.auth.feature.completeregistration.completeRegistrationDestination
import com.vowkey.app.ui.auth.feature.completeregistration.navigateToCompleteRegistration
import com.vowkey.app.ui.auth.feature.completeregistration.popUpToCompleteRegistration
import com.vowkey.app.ui.auth.feature.enterprisesignon.enterpriseSignOnDestination
import com.vowkey.app.ui.auth.feature.enterprisesignon.navigateToEnterpriseSignOn
import com.vowkey.app.ui.auth.feature.environment.environmentDestination
import com.vowkey.app.ui.auth.feature.environment.navigateToEnvironment
import com.vowkey.app.ui.auth.feature.expiredregistrationlink.expiredRegistrationLinkDestination
import com.vowkey.app.ui.auth.feature.landing.LandingRoute
import com.vowkey.app.ui.auth.feature.landing.landingDestination
import com.vowkey.app.ui.auth.feature.landing.navigateToLanding
import com.vowkey.app.ui.auth.feature.login.loginDestination
import com.vowkey.app.ui.auth.feature.login.navigateToLogin
import com.vowkey.app.ui.auth.feature.loginwithdevice.loginWithDeviceDestination
import com.vowkey.app.ui.auth.feature.loginwithdevice.model.LoginWithDeviceType
import com.vowkey.app.ui.auth.feature.loginwithdevice.navigateToLoginWithDevice
import com.vowkey.app.ui.auth.feature.masterpasswordgenerator.masterPasswordGeneratorDestination
import com.vowkey.app.ui.auth.feature.masterpasswordgenerator.navigateToMasterPasswordGenerator
import com.vowkey.app.ui.auth.feature.masterpasswordguidance.masterPasswordGuidanceDestination
import com.vowkey.app.ui.auth.feature.masterpasswordguidance.navigateToMasterPasswordGuidance
import com.vowkey.app.ui.auth.feature.masterpasswordhint.masterPasswordHintDestination
import com.vowkey.app.ui.auth.feature.masterpasswordhint.navigateToMasterPasswordHint
import com.vowkey.app.ui.auth.feature.preventaccountlockout.navigateToPreventAccountLockout
import com.vowkey.app.ui.auth.feature.preventaccountlockout.preventAccountLockoutDestination
import com.vowkey.app.ui.auth.feature.setpassword.navigateToSetPassword
import com.vowkey.app.ui.auth.feature.setpassword.setPasswordDestination
import com.vowkey.app.ui.auth.feature.startregistration.navigateToStartRegistration
import com.vowkey.app.ui.auth.feature.startregistration.startRegistrationDestination
import com.vowkey.app.ui.auth.feature.twofactorlogin.navigateToTwoFactorLogin
import com.vowkey.app.ui.auth.feature.twofactorlogin.twoFactorLoginDestination
import com.vowkey.app.ui.auth.feature.welcome.welcomeDestination
import com.vowkey.app.ui.platform.feature.settings.navigateToPreAuthSettings
import com.vowkey.app.ui.platform.feature.settings.preAuthSettingsDestinations
import kotlinx.serialization.Serializable

/**
 * The type-safe route for the auth graph.
 */
@Serializable
data object AuthGraphRoute

/**
 * Add auth destinations to the nav graph.
 */
@Suppress("LongMethod")
fun NavGraphBuilder.authGraph(
    navController: NavHostController,
) {
    navigation<AuthGraphRoute>(
        startDestination = LandingRoute,
    ) {
        startRegistrationDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToCompleteRegistration = { emailAddress, verificationToken ->
                navController.navigateToCompleteRegistration(
                    emailAddress = emailAddress,
                    verificationToken = verificationToken,
                    fromEmail = false,
                )
            },
            onNavigateToCheckEmail = { emailAddress ->
                navController.navigateToCheckEmail(emailAddress = emailAddress)
            },
            onNavigateToEnvironment = { navController.navigateToEnvironment() },
        )
        checkEmailDestination(
            onNavigateBack = { navController.popBackStack() },
        )
        completeRegistrationDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToPasswordGuidance = {
                navController.navigateToMasterPasswordGuidance()
            },
            onNavigateToPreventAccountLockout = {
                navController.navigateToPreventAccountLockout(isPasswordReset = false)
            },
            onNavigateToLogin = { emailAddress ->
                navController.navigateToLogin(
                    emailAddress = emailAddress,
                    navOptions = navOptions {
                        popUpTo(route = LandingRoute)
                    },
                )
            },
        )
        enterpriseSignOnDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToSetPassword = { navController.navigateToSetPassword() },
            onNavigateToTwoFactorLogin = { emailAddress, orgIdentifier ->
                navController.navigateToTwoFactorLogin(
                    emailAddress = emailAddress,
                    password = null,
                    orgIdentifier = orgIdentifier,
                )
            },
        )
        setPasswordDestination()
        landingDestination(
            onNavigateToLogin = { emailAddress ->
                navController.navigateToLogin(
                    emailAddress = emailAddress,
                )
            },
            onNavigateToEnvironment = {
                navController.navigateToEnvironment()
            },
            onNavigateToStartRegistration = { navController.navigateToStartRegistration() },
            onNavigateToPreAuthSettings = { navController.navigateToPreAuthSettings() },
        )
        welcomeDestination(
            onNavigateToLogin = { navController.navigateToLanding() },
            onNavigateToStartRegistration = { navController.navigateToStartRegistration() },
        )
        loginDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToMasterPasswordHint = { emailAddress ->
                navController.navigateToMasterPasswordHint(
                    emailAddress = emailAddress,
                )
            },
            onNavigateToEnterpriseSignOn = { emailAddress ->
                navController.navigateToEnterpriseSignOn(
                    emailAddress = emailAddress,
                )
            },
            onNavigateToLoginWithDevice = { emailAddress ->
                navController.navigateToLoginWithDevice(
                    emailAddress = emailAddress,
                    loginType = LoginWithDeviceType.OTHER_DEVICE,
                )
            },
            onNavigateToTwoFactorLogin = { emailAddress, password, isNewDeviceVerification ->
                navController.navigateToTwoFactorLogin(
                    emailAddress = emailAddress,
                    password = password,
                    orgIdentifier = null,
                    isNewDeviceVerification = isNewDeviceVerification,
                )
            },
        )
        loginWithDeviceDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToTwoFactorLogin = {
                navController.navigateToTwoFactorLogin(
                    emailAddress = it,
                    password = null,
                    orgIdentifier = null,
                )
            },
        )
        environmentDestination(
            onNavigateBack = { navController.popBackStack() },
        )
        masterPasswordHintDestination(
            onNavigateBack = { navController.popBackStack() },
        )
        twoFactorLoginDestination(
            onNavigateBack = { navController.popBackStack() },
        )
        masterPasswordGuidanceDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToGeneratePassword = { navController.navigateToMasterPasswordGenerator() },
        )
        preventAccountLockoutDestination(
            isPasswordReset = false,
            onNavigateBack = { navController.popBackStack() },
        )
        masterPasswordGeneratorDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToPreventLockout = {
                navController.navigateToPreventAccountLockout(isPasswordReset = false)
            },
            onNavigateBackWithPassword = {
                navController.popUpToCompleteRegistration()
            },
        )
        expiredRegistrationLinkDestination(
            onNavigateBack = { navController.popBackStack() },
            onNavigateToStartRegistration = {
                navController.navigateToStartRegistration(
                    navOptions = navOptions {
                        popUpTo(route = LandingRoute)
                    },
                )
            },
            onNavigateToLogin = {
                navController.navigateToLanding(
                    navOptions = navOptions {
                        popUpTo(route = LandingRoute)
                    },
                )
            },
        )
        preAuthSettingsDestinations(navController = navController)
    }
}

/**
 * Navigate to the auth screen. Note this will only work if auth destination was added
 * via [authGraph].
 */
fun NavController.navigateToAuthGraph(
    navOptions: NavOptions? = null,
) {
    navigate(route = AuthGraphRoute, navOptions = navOptions)
}
