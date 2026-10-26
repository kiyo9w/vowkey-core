package com.vowkey.ui.platform.components.badge

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.onNodeWithText
import com.vowkey.ui.platform.base.BaseComposeTest
import com.vowkey.ui.platform.theme.VowkeyTheme
import org.junit.Test

class VowkeyStatusBadgeTest : BaseComposeTest() {

    @Test
    fun `success variant renders with label`() {
        setTestContent {
            VowkeyTheme {
                VowkeyStatusBadge(
                    label = "Active",
                    colors = VowkeyTheme.colorScheme.statusBadge.success,
                )
            }
        }
        composeTestRule.onNodeWithText("Active").assertIsDisplayed()
    }

    @Test
    fun `error variant renders with label`() {
        setTestContent {
            VowkeyTheme {
                VowkeyStatusBadge(
                    label = "Canceled",
                    colors = VowkeyTheme.colorScheme.statusBadge.error,
                )
            }
        }
        composeTestRule.onNodeWithText("Canceled").assertIsDisplayed()
    }

    @Test
    fun `warning variant renders with label`() {
        setTestContent {
            VowkeyTheme {
                VowkeyStatusBadge(
                    label = "Overdue payment",
                    colors = VowkeyTheme.colorScheme.statusBadge.warning,
                )
            }
        }
        composeTestRule.onNodeWithText("Overdue payment").assertIsDisplayed()
    }
}
