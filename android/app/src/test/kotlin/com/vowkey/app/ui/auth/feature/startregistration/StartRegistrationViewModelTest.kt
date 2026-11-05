package com.vowkey.app.ui.auth.feature.startregistration

import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.vowkey.core.data.manager.model.FlagKey
import com.vowkey.core.data.repository.util.bufferedMutableSharedFlow
import com.vowkey.data.datasource.disk.model.ServerConfig
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.model.Environment
import com.vowkey.network.model.ConfigResponseJson
import com.vowkey.ui.platform.base.BaseViewModelTest
import com.vowkey.ui.platform.components.snackbar.model.VowkeySnackbarData
import com.vowkey.ui.platform.manager.snackbar.SnackbarRelayManager
import com.vowkey.ui.platform.resource.VowkeyString
import com.vowkey.ui.util.asText
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.model.SendVerificationEmailResult
import com.vowkey.app.data.platform.manager.FeatureFlagManager
import com.vowkey.app.data.platform.manager.network.NetworkConnectionManager
import com.vowkey.app.data.platform.repository.util.FakeEnvironmentRepository
import com.vowkey.app.data.tools.generator.repository.GeneratorRepository
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.CloseClick
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.ContinueClick
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.EmailInputChange
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.EnvironmentTypeSelect
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.NameInputChange
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.PrivacyPolicyClick
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.ReceiveMarketingEmailsToggle
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.TermsClick
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationAction.UnsubscribeMarketingEmailsClick
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateBack
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToCompleteRegistration
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToEnvironment
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToPrivacyPolicy
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToTerms
import com.vowkey.app.ui.auth.feature.startregistration.StartRegistrationEvent.NavigateToUnsubscribe
import com.vowkey.app.ui.platform.model.SnackbarRelay
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

@Suppress("LargeClass")
class StartRegistrationViewModelTest : BaseViewModelTest() {
    private val mockAuthRepository = mockk<AuthRepository> {
        every { ssoCallbackResultFlow } returns emptyFlow()
    }
    private val generatorRepository = mockk<GeneratorRepository>(relaxed = true)
    private val networkConnectionManager = mockk<NetworkConnectionManager> {
        every { isNetworkConnected } returns true
    }
    private val mutableSocialLoginFlagStateFlow = MutableStateFlow(false)
    private val featureFlagManager = mockk<FeatureFlagManager> {
        every { getFeatureFlagFlow(FlagKey.SocialLogin) } returns mutableSocialLoginFlagStateFlow
        every { getFeatureFlag(FlagKey.SocialLogin) } answers { mutableSocialLoginFlagStateFlow.value }
    }
    private val mutableSnackbarSharedFlow = bufferedMutableSharedFlow<VowkeySnackbarData>()
    private val snackbarRelayManager = mockk<SnackbarRelayManager<SnackbarRelay>> {
        every {
            getSnackbarDataFlow(SnackbarRelay.ENVIRONMENT_SAVED)
        } returns mutableSnackbarSharedFlow
    }
    private val fakeEnvironmentRepository = FakeEnvironmentRepository()
    private val mutableServerConfigFlow = MutableStateFlow<ServerConfig?>(null)
    private val serverConfigRepository: ServerConfigRepository = mockk {
        every { serverConfigStateFlow } returns mutableServerConfigFlow
    }

    @Test
    fun `initial state should be correct`() {
        val viewModel = createViewModel()
        assertEquals(DEFAULT_STATE, viewModel.stateFlow.value)
    }

    @Test
    fun `initial state should pull from saved state handle when present`() {
        val savedState = StartRegistrationState(
            emailInput = "saved@vowkey.app",
            nameInput = "Saved User",
            isReceiveMarketingEmailsToggled = false,
            isContinueButtonEnabled = true,
            selectedEnvironmentType = Environment.Type.US,
            dialog = null,
        )
        val viewModel = createViewModel(savedState)
        assertEquals(savedState, viewModel.stateFlow.value)
    }

    @Test
    fun `ContinueClick with blank email should show email required`() = runTest {
        val viewModel = createViewModel()
        val input = "a"
        viewModel.trySendAction(EmailInputChange(input))
        val expectedState = DEFAULT_STATE.copy(
            emailInput = input,
            isContinueButtonEnabled = true,
            dialog = StartRegistrationDialog.Error(
                title = VowkeyString.an_error_has_occurred.asText(),
                message = VowkeyString.invalid_email.asText(),
            ),
        )
        viewModel.trySendAction(ContinueClick)
        viewModel.stateFlow.test {
            assertEquals(expectedState, awaitItem())
        }
    }

    @Test
    fun `ContinueClick with invalid email should show invalid email`() = runTest {
        val viewModel = createViewModel()
        val input = " "
        viewModel.trySendAction(EmailInputChange(input))
        val expectedState = DEFAULT_STATE.copy(
            emailInput = input,
            dialog = StartRegistrationDialog.Error(
                title = VowkeyString.an_error_has_occurred.asText(),
                message = VowkeyString.validation_field_required
                    .asText(VowkeyString.email_address.asText()),
            ),
        )
        viewModel.trySendAction(ContinueClick)
        viewModel.stateFlow.test {
            assertEquals(expectedState, awaitItem())
        }
    }

    @Test
    fun `ContinueClick with all inputs valid should show and hide loading dialog`() = runTest {
        coEvery {
            mockAuthRepository.sendVerificationEmail(
                email = EMAIL,
                name = NAME,
                receiveMarketingEmails = false,
            )
        } returns SendVerificationEmailResult.Success(
            emailVerificationToken = "verification_token",
        )
        val viewModel = createViewModel(VALID_INPUT_STATE)
        viewModel.stateEventFlow(backgroundScope) { stateFlow, eventFlow ->
            assertEquals(VALID_INPUT_STATE, stateFlow.awaitItem())
            viewModel.trySendAction(ContinueClick)
            assertEquals(
                VALID_INPUT_STATE.copy(dialog = StartRegistrationDialog.Loading),
                stateFlow.awaitItem(),
            )
            assertEquals(
                NavigateToCompleteRegistration(EMAIL, "verification_token"),
                eventFlow.awaitItem(),
            )
            // Make sure loading dialog is hidden:
            assertEquals(VALID_INPUT_STATE, stateFlow.awaitItem())
        }
    }

    @Test
    fun `ContinueClick register returns error should update errorDialogState`() = runTest {
        val error = Throwable("Fail!")
        coEvery {
            mockAuthRepository.sendVerificationEmail(
                email = EMAIL,
                name = NAME,
                receiveMarketingEmails = false,
            )
        } returns SendVerificationEmailResult.Error(errorMessage = "mock_error", error = error)
        val viewModel = createViewModel(VALID_INPUT_STATE)
        viewModel.stateFlow.test {
            assertEquals(VALID_INPUT_STATE, awaitItem())
            viewModel.trySendAction(ContinueClick)
            assertEquals(
                VALID_INPUT_STATE.copy(dialog = StartRegistrationDialog.Loading),
                awaitItem(),
            )
            assertEquals(
                VALID_INPUT_STATE.copy(
                    dialog = StartRegistrationDialog.Error(
                        title = VowkeyString.an_error_has_occurred.asText(),
                        message = "mock_error".asText(),
                        error = error,
                    ),
                ),
                awaitItem(),
            )
        }
    }

    @Suppress("MaxLineLength")
    @Test
    fun `ContinueClick register returns Success with emailVerificationToken should emit NavigateToCompleteRegistration`() =
        runTest {
            coEvery {
                mockAuthRepository.sendVerificationEmail(
                    email = EMAIL,
                    name = NAME,
                    receiveMarketingEmails = false,
                )
            } returns SendVerificationEmailResult.Success(
                emailVerificationToken = "verification_token",
            )
            val viewModel = createViewModel(VALID_INPUT_STATE)
            viewModel.eventFlow.test {
                viewModel.trySendAction(ContinueClick)
                assertEquals(
                    NavigateToCompleteRegistration(
                        email = EMAIL,
                        verificationToken = "verification_token",
                    ),
                    awaitItem(),
                )
            }
        }

    @Suppress("MaxLineLength")
    @Test
    fun `ContinueClick register returns Success without emailVerificationToken should emit NavigateToCheckEmail`() =
        runTest {
            coEvery {
                mockAuthRepository.sendVerificationEmail(
                    email = EMAIL,
                    name = NAME,
                    receiveMarketingEmails = false,
                )
            } returns SendVerificationEmailResult.Success(
                emailVerificationToken = null,
            )
            val viewModel = createViewModel(VALID_INPUT_STATE)
            viewModel.eventFlow.test {
                viewModel.trySendAction(ContinueClick)
                assertEquals(
                    StartRegistrationEvent.NavigateToCheckEmail(
                        email = EMAIL,
                    ),
                    awaitItem(),
                )
            }
        }

    @Test
    fun `BackClick should emit NavigateBack`() = runTest {
        val viewModel = createViewModel()
        viewModel.eventFlow.test {
            viewModel.trySendAction(CloseClick)
            assertEquals(NavigateBack, awaitItem())
        }
    }

    @Test
    fun `PrivacyPolicyClick should emit NavigatePrivacyPolicy`() = runTest {
        val viewModel = createViewModel()
        viewModel.eventFlow.test {
            viewModel.trySendAction(PrivacyPolicyClick)
            assertEquals(NavigateToPrivacyPolicy, awaitItem())
        }
    }

    @Test
    fun `TermsClick should emit NavigateToTerms`() = runTest {
        val viewModel = createViewModel()
        viewModel.eventFlow.test {
            viewModel.trySendAction(TermsClick)
            assertEquals(NavigateToTerms, awaitItem())
        }
    }

    @Test
    fun `UnsubscribeMarketingEmailsClick should emit NavigateToUnsubscribe`() = runTest {
        val viewModel = createViewModel()
        viewModel.eventFlow.test {
            viewModel.trySendAction(UnsubscribeMarketingEmailsClick)
            assertEquals(NavigateToUnsubscribe, awaitItem())
        }
    }

    @Test
    fun `EnvironmentTypeSelect should update value of selected region for UE, US, and FedRAMP`() =
        runTest {
            val viewModel = createViewModel()
            viewModel.stateFlow.test {
                skipItems(count = 1)

                viewModel.trySendAction(
                    EnvironmentTypeSelect(environmentType = Environment.Type.EU),
                )
                assertEquals(
                    DEFAULT_STATE.copy(selectedEnvironmentType = Environment.Type.EU),
                    awaitItem(),
                )

                viewModel.trySendAction(
                    EnvironmentTypeSelect(environmentType = Environment.Type.US),
                )
                assertEquals(
                    DEFAULT_STATE.copy(selectedEnvironmentType = Environment.Type.US),
                    awaitItem(),
                )

                viewModel.trySendAction(
                    EnvironmentTypeSelect(environmentType = Environment.Type.FED_RAMP),
                )
                expectNoEvents()
            }
        }

    @Test
    fun `EnvironmentTypeSelect should emit NavigateToEnvironment for self-hosted`() = runTest {
        val inputEnvironmentType = Environment.Type.SELF_HOSTED
        val viewModel = createViewModel()
        viewModel.eventFlow.test {
            viewModel.trySendAction(
                EnvironmentTypeSelect(
                    inputEnvironmentType,
                ),
            )
            assertEquals(
                NavigateToEnvironment,
                awaitItem(),
            )
        }
    }

    @Test
    fun `EmailInputChange update email`() = runTest {
        val viewModel = createViewModel()
        viewModel.trySendAction(EmailInputChange("input"))
        viewModel.stateFlow.test {
            assertEquals(
                DEFAULT_STATE.copy(
                    emailInput = "input",
                    isContinueButtonEnabled = true,
                ),
                awaitItem(),
            )
        }
    }

    @Test
    fun `NameInputChange update name`() = runTest {
        val viewModel = createViewModel()
        viewModel.trySendAction(NameInputChange("input"))
        viewModel.stateFlow.test {
            assertEquals(DEFAULT_STATE.copy(nameInput = "input"), awaitItem())
        }
    }

    @Test
    fun `ReceiveMarketingEmailsToggle update isReceiveMarketingEmailsToggled`() = runTest {
        val viewModel = createViewModel()
        viewModel.trySendAction(ReceiveMarketingEmailsToggle(true))
        viewModel.stateFlow.test {
            assertEquals(DEFAULT_STATE.copy(isReceiveMarketingEmailsToggled = true), awaitItem())
        }
    }

    @Test
    fun `ServerGeologyHelpClickAction should emit NavigateToServerSelectionInfo`() = runTest {
        val viewModel = createViewModel()

        viewModel.eventFlow.test {
            viewModel.trySendAction(StartRegistrationAction.ServerGeologyHelpClick)
            assertEquals(StartRegistrationEvent.NavigateToServerSelectionInfo, awaitItem())
        }
    }

    @Test
    fun `SnackbarDataReceive should update emit ShowSnackbar`() = runTest {
        val viewModel = createViewModel()
        val snackbarData = VowkeySnackbarData(message = "Test".asText())
        viewModel.eventFlow.test {
            mutableSnackbarSharedFlow.tryEmit(snackbarData)
            assertEquals(StartRegistrationEvent.ShowSnackbar(data = snackbarData), awaitItem())
        }
    }

    @Test
    fun `ServerConfigReceive with user registration disabled should show error dialog`() =
        runTest {
            val viewModel = createViewModel()
            viewModel.stateFlow.test {
                assertEquals(DEFAULT_STATE, awaitItem())
                mutableServerConfigFlow.value = createServerConfig(disableUserRegistration = true)
                assertEquals(
                    DEFAULT_STATE.copy(
                        dialog = StartRegistrationDialog.Error(
                            title = VowkeyString.account_creation_restricted.asText(),
                            message = VowkeyString
                                .only_allows_invited_users_to_create_accounts
                                .asText("https://vowkey.com"),
                        ),
                    ),
                    awaitItem(),
                )
            }
        }

    @Test
    fun `ServerConfigReceive with user registration enabled should not update state`() =
        runTest {
            val viewModel = createViewModel()
            viewModel.stateFlow.test {
                assertEquals(DEFAULT_STATE, awaitItem())
                mutableServerConfigFlow.value = createServerConfig(disableUserRegistration = false)
                expectNoEvents()
            }
        }

    private fun createViewModel(
        state: StartRegistrationState? = null,
    ): StartRegistrationViewModel =
        StartRegistrationViewModel(
            authRepository = mockAuthRepository,
            environmentRepository = fakeEnvironmentRepository,
            serverConfigRepository = serverConfigRepository,
            snackbarRelayManager = snackbarRelayManager,
            featureFlagManager = featureFlagManager,
            generatorRepository = generatorRepository,
            networkConnectionManager = networkConnectionManager,
            savedStateHandle = SavedStateHandle().apply {
                set(key = "state", value = state)
            },
        )
}

private const val EMAIL: String = "test@test.com"
private const val NAME: String = "name"
private val DEFAULT_STATE: StartRegistrationState = StartRegistrationState(
    emailInput = "",
    nameInput = "",
    isReceiveMarketingEmailsToggled = false,
    isContinueButtonEnabled = false,
    selectedEnvironmentType = Environment.Type.US,
    dialog = null,
)
private val VALID_INPUT_STATE: StartRegistrationState = StartRegistrationState(
    emailInput = EMAIL,
    nameInput = NAME,
    isReceiveMarketingEmailsToggled = false,
    isContinueButtonEnabled = true,
    selectedEnvironmentType = Environment.Type.US,
    dialog = null,
)

private fun createServerConfig(
    disableUserRegistration: Boolean,
): ServerConfig = ServerConfig(
    lastSync = 0L,
    serverData = ConfigResponseJson(
        type = null,
        version = null,
        gitHash = null,
        server = null,
        environment = ConfigResponseJson.EnvironmentJson(
            cloudRegion = "US",
            vaultUrl = "https://vowkey.com",
            apiUrl = "https://api.vowkey.com",
            identityUrl = "https://identity.vowkey.com",
            notificationsUrl = "https://notifications.vowkey.com",
            ssoUrl = null,
            fillAssistRulesUrl = null,
        ),
        featureStates = null,
        communication = null,
        settings = ConfigResponseJson.SettingJson(
            disableUserRegistration = disableUserRegistration,
        ),
    ),
)
