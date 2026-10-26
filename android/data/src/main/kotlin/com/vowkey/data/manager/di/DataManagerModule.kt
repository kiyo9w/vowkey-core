package com.vowkey.data.manager.di

import android.app.Application
import android.content.Context
import com.vowkey.core.data.manager.BuildInfoManager
import com.vowkey.core.data.manager.UuidManager
import com.vowkey.core.data.manager.dispatcher.DispatcherManager
import com.vowkey.data.datasource.disk.ConfigDiskSource
import com.vowkey.data.datasource.disk.FlightRecorderDiskSource
import com.vowkey.data.manager.VowkeyPackageManager
import com.vowkey.data.manager.VowkeyPackageManagerImpl
import com.vowkey.data.manager.NativeLibraryManager
import com.vowkey.data.manager.NativeLibraryManagerImpl
import com.vowkey.data.manager.appstate.AppStateManager
import com.vowkey.data.manager.appstate.AppStateManagerImpl
import com.vowkey.data.manager.file.FileManager
import com.vowkey.data.manager.file.FileManagerImpl
import com.vowkey.data.manager.flightrecorder.FlightRecorderManager
import com.vowkey.data.manager.flightrecorder.FlightRecorderManagerImpl
import com.vowkey.data.manager.flightrecorder.FlightRecorderWriter
import com.vowkey.data.manager.flightrecorder.FlightRecorderWriterImpl
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.time.Clock
import javax.inject.Singleton

/**
 * Provides managers in the data module.
 */
@Module
@InstallIn(SingletonComponent::class)
object DataManagerModule {

    @Provides
    @Singleton
    fun provideAppStateManager(
        application: Application,
    ): AppStateManager = AppStateManagerImpl(application = application)

    @Provides
    @Singleton
    fun provideVowkeyPackageManager(
        @ApplicationContext context: Context,
    ): VowkeyPackageManager = VowkeyPackageManagerImpl(context = context)

    @Provides
    @Singleton
    fun provideFileManager(
        @ApplicationContext context: Context,
        uuidManager: UuidManager,
        dispatcherManager: DispatcherManager,
    ): FileManager = FileManagerImpl(
        context = context,
        uuidManager = uuidManager,
        dispatcherManager = dispatcherManager,
    )

    @Provides
    @Singleton
    fun provideFlightRecorderManager(
        @ApplicationContext context: Context,
        clock: Clock,
        dispatcherManager: DispatcherManager,
        flightRecorderDiskSource: FlightRecorderDiskSource,
        flightRecorderWriter: FlightRecorderWriter,
    ): FlightRecorderManager = FlightRecorderManagerImpl(
        context = context,
        clock = clock,
        dispatcherManager = dispatcherManager,
        flightRecorderDiskSource = flightRecorderDiskSource,
        flightRecorderWriter = flightRecorderWriter,
    )

    @Provides
    @Singleton
    fun provideFlightRecorderWriter(
        clock: Clock,
        fileManager: FileManager,
        dispatcherManager: DispatcherManager,
        buildInfoManager: BuildInfoManager,
        configDiskSource: ConfigDiskSource,
    ): FlightRecorderWriter = FlightRecorderWriterImpl(
        clock = clock,
        fileManager = fileManager,
        dispatcherManager = dispatcherManager,
        buildInfoManager = buildInfoManager,
        configDiskSource = configDiskSource,
    )

    @Provides
    @Singleton
    fun provideNativeLibraryManager(): NativeLibraryManager = NativeLibraryManagerImpl()
}
