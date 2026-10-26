package com.vowkey.app.data.push

import com.vowkey.annotation.OmitFromCoverage
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.vowkey.app.data.platform.manager.PushManager
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject

/**
 * Handles setup and receiving of push notifications.
 */
@OmitFromCoverage
@AndroidEntryPoint
class VowkeyFirebaseMessagingService : FirebaseMessagingService() {
    @Inject
    lateinit var pushManager: PushManager

    override fun onMessageReceived(message: RemoteMessage) {
        pushManager.onMessageReceived(message.data)
    }

    override fun onNewToken(token: String) {
        pushManager.registerPushTokenIfNecessary(token)
    }
}
