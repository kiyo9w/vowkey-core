package com.vowkey.app.data.platform.manager.network

import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.core.data.manager.dispatcher.FakeDispatcherManager
import com.vowkey.core.data.util.advanceTimeByAndRunCurrent
import com.vowkey.data.repository.ServerConfigRepository
import com.vowkey.data.repository.model.Environment
import com.vowkey.network.VowkeyServiceClient
import com.vowkey.app.data.auth.repository.AuthRepository
import com.vowkey.app.data.auth.repository.model.AuthState
import com.vowkey.app.data.auth.repository.model.UserState
import com.vowkey.app.data.platform.repository.EnvironmentRepository
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.just
import io.mockk.mockk
import io.mockk.runs
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class NetworkConfigManagerTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private val dispatcherManager: DispatcherManager = FakeDispatcherManager(
        unconfined = testDispatcher,
    )
    private val mutableAuthStateFlow = MutableStateFlow<AuthState>(AuthState.Uninitialized)
    private val mutableUserStateFlow = MutableStateFlow<UserState?>(null)
    private val mutableEnvironmentStateFlow = MutableStateFlow<Environment>(Environment.Prod.Us)

    private val authRepository: AuthRepository = mockk {
        every { authStateFlow } returns mutableAuthStateFlow
        every { userStateFlow } returns mutableUserStateFlow
    }
    private val environmentRepository: EnvironmentRepository = mockk {
        every { environmentStateFlow } returns mutableEnvironmentStateFlow
    }
    private val serverConfigRepository: ServerConfigRepository = mockk {
        coEvery { getServerConfig(forceRefresh = true) } returns null
    }
    private val mockVowkeyServiceClient: VowkeyServiceClient = mockk {
        every { setRefreshTokenProvider(any()) } just runs
    }

    private lateinit var networkConfigManager: NetworkConfigManager

    @BeforeEach
    fun setUp() {
        networkConfigManager = NetworkConfigManagerImpl(
            authRepository = authRepository,
            environmentRepository = environmentRepository,
            serverConfigRepository = serverConfigRepository,
            vowkeyServiceClient = mockVowkeyServiceClient,
            dispatcherManager = dispatcherManager,
        )
    }

    @Suppress("MaxLineLength")
    @Test
    fun `changes in the Environment or active user ID should call getServerConfig after debounce period`() {
        mutableEnvironmentStateFlow.value = Environment.Prod.Eu
        mutableUserStateFlow.value = mockk { every { activeUserId } returns "userId" }
        mutableEnvironmentStateFlow.value = Environment.Prod.Us
        mutableUserStateFlow.value = null
        testDispatcher.advanceTimeByAndRunCurrent(delayTimeMillis = 500L)
        coVerify(exactly = 1) {
            serverConfigRepository.getServerConfig(forceRefresh = true)
        }
    }
}
