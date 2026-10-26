package com.vowkey.network.retrofit

import com.vowkey.network.core.NetworkResultCallAdapterFactory
import com.vowkey.network.interceptor.AuthTokenManager
import com.vowkey.network.interceptor.BaseUrlInterceptor
import com.vowkey.network.interceptor.BaseUrlInterceptors
import com.vowkey.network.interceptor.CookieInterceptor
import com.vowkey.network.interceptor.DeviceIdentifierInterceptor
import com.vowkey.network.interceptor.HeadersInterceptor
import com.vowkey.network.interceptor.PermissionInterceptor
import com.vowkey.network.ssl.CertificateProvider
import com.vowkey.network.ssl.configureSsl
import com.vowkey.network.util.HEADER_KEY_AUTHORIZATION
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import timber.log.Timber

/**
 * Primary implementation of [Retrofits].
 */
@Suppress("LongParameterList")
internal class RetrofitsImpl(
    authTokenManager: AuthTokenManager,
    baseUrlInterceptors: BaseUrlInterceptors,
    cookieInterceptor: CookieInterceptor,
    private val deviceIdentifierInterceptor: DeviceIdentifierInterceptor,
    headersInterceptor: HeadersInterceptor,
    json: Json,
    private val permissionInterceptor: PermissionInterceptor,
    private val certificateProvider: CertificateProvider,
    private val logHttpBody: Boolean = false,
) : Retrofits {
    //region Authenticated Retrofits

    override val authenticatedApiRetrofit: Retrofit by lazy {
        createAuthenticatedRetrofit(
            baseUrlInterceptor = baseUrlInterceptors.apiInterceptor,
        )
    }

    override val authenticatedEventsRetrofit: Retrofit by lazy {
        createAuthenticatedRetrofit(
            baseUrlInterceptor = baseUrlInterceptors.eventsInterceptor,
        )
    }

    //endregion Authenticated Retrofits

    //region Unauthenticated Retrofits

    override val unauthenticatedApiRetrofit: Retrofit by lazy {
        createUnauthenticatedRetrofit(
            baseUrlInterceptor = baseUrlInterceptors.apiInterceptor,
        )
    }

    override val unauthenticatedIdentityRetrofit: Retrofit by lazy {
        createUnauthenticatedRetrofit(
            baseUrlInterceptor = baseUrlInterceptors.identityInterceptor,
        )
    }

    //endregion Unauthenticated Retrofits

    //region Fill-Assist Retrofit

    override val fillAssistRetrofit: Retrofit by lazy {
        createExternalRetrofit(
            baseUrlInterceptor = baseUrlInterceptors.fillAssistInterceptor,
        )
    }

    //endregion Fill-Assist Retrofit

    //region Static Retrofit

    override fun createStaticRetrofit(isAuthenticated: Boolean, baseUrl: String): Retrofit {
        val baseClient = if (isAuthenticated) authenticatedOkHttpClient else baseOkHttpClient
        return baseRetrofitBuilder
            .baseUrl(baseUrl)
            .client(
                baseClient
                    .newBuilder()
                    .addInterceptor(loggingInterceptor)
                    .addInterceptor(permissionInterceptor)
                    .build(),
            )
            .build()
    }

    //endregion Static Retrofit

    //region Helper properties and functions
    private val loggingInterceptor: HttpLoggingInterceptor by lazy {
        HttpLoggingInterceptor { message -> Timber.tag("VowkeyNetworkClient").d(message) }
            .apply {
                redactHeader(name = HEADER_KEY_AUTHORIZATION)
                setLevel(
                    level = HttpLoggingInterceptor.Level.BODY
                        .takeIf { logHttpBody }
                        ?: HttpLoggingInterceptor.Level.BASIC,
                )
            }
    }

    private val baseOkHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(headersInterceptor)
        .addNetworkInterceptor(cookieInterceptor)
        .configureSsl(certificateProvider = certificateProvider)
        .build()

    // For requests to external (non-Vowkey) URLs. CookieInterceptor must be excluded because
    // it treats all 302s as Vowkey load-balancer auth redirects, which is only correct for
    // Vowkey's own infrastructure.
    private val externalOkHttpClient: OkHttpClient = OkHttpClient.Builder()
        .addInterceptor(headersInterceptor)
        .configureSsl(certificateProvider = certificateProvider)
        .build()

    private val authenticatedOkHttpClient: OkHttpClient by lazy {
        baseOkHttpClient
            .newBuilder()
            .addInterceptor(authTokenManager)
            .authenticator(authTokenManager)
            .build()
    }

    private val baseRetrofit: Retrofit by lazy {
        baseRetrofitBuilder
            .baseUrl("https://api.vowkey.com")
            .build()
    }

    private val baseRetrofitBuilder: Retrofit.Builder by lazy {
        Retrofit.Builder()
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .addCallAdapterFactory(NetworkResultCallAdapterFactory())
            .client(baseOkHttpClient)
    }

    private fun createAuthenticatedRetrofit(
        baseUrlInterceptor: BaseUrlInterceptor,
    ): Retrofit =
        baseRetrofit
            .newBuilder()
            .client(
                authenticatedOkHttpClient
                    .newBuilder()
                    .addInterceptor(deviceIdentifierInterceptor)
                    .addInterceptor(baseUrlInterceptor)
                    .addInterceptor(loggingInterceptor)
                    .addInterceptor(permissionInterceptor)
                    .build(),
            )
            .build()

    private fun createUnauthenticatedRetrofit(
        baseUrlInterceptor: BaseUrlInterceptor,
    ): Retrofit =
        baseRetrofit
            .newBuilder()
            .client(
                baseOkHttpClient
                    .newBuilder()
                    .addInterceptor(deviceIdentifierInterceptor)
                    .addInterceptor(baseUrlInterceptor)
                    .addInterceptor(loggingInterceptor)
                    .addInterceptor(permissionInterceptor)
                    .build(),
            )
            .build()

    private fun createExternalRetrofit(
        baseUrlInterceptor: BaseUrlInterceptor,
    ): Retrofit =
        baseRetrofit
            .newBuilder()
            .client(
                externalOkHttpClient
                    .newBuilder()
                    .addInterceptor(baseUrlInterceptor)
                    .addInterceptor(loggingInterceptor)
                    .addInterceptor(permissionInterceptor)
                    .build(),
            )
            .build()

    //endregion Helper properties and functions
}
