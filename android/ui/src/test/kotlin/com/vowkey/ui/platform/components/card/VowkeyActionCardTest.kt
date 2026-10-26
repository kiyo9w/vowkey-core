package com.vowkey.ui.platform.components.card

import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.hasClickAction
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import com.vowkey.ui.platform.base.BaseComposeTest
import com.vowkey.ui.platform.components.button.model.VowkeyButtonData
import com.vowkey.ui.platform.theme.VowkeyTheme
import com.vowkey.ui.util.asText
import org.junit.Assert.assertEquals
import org.junit.Test

class VowkeyActionCardTest : BaseComposeTest() {

    @Test
    fun `action button content description defaults to the action button label`() {
        setTestContent {
            VowkeyTheme {
                VowkeyActionCard(
                    cardTitle = "Title",
                    actionButton = VowkeyButtonData(
                        label = "Learn more".asText(),
                        onClick = {},
                    ),
                )
            }
        }
        composeTestRule
            .onNodeWithContentDescription(label = "Learn more")
            .assertIsDisplayed()
    }

    @Test
    fun `action button announces external-link affordance when isExternalLink is true`() {
        setTestContent {
            VowkeyTheme {
                VowkeyActionCard(
                    cardTitle = "Title",
                    actionButton = VowkeyButtonData(
                        label = "Learn more".asText(),
                        onClick = {},
                        isExternalLink = true,
                    ),
                )
            }
        }
        composeTestRule
            .onNodeWithContentDescription(label = "Learn more, External link")
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(text = "Learn more")
            .assertIsDisplayed()
    }

    @Test
    fun `no buttons are displayed when neither button is provided`() {
        setTestContent {
            VowkeyTheme {
                VowkeyActionCard(
                    cardTitle = "Title",
                    cardSubtitle = "Subtitle",
                )
            }
        }
        composeTestRule
            .onNodeWithText(text = "Subtitle")
            .assertIsDisplayed()
        composeTestRule
            .onNode(matcher = hasClickAction())
            .assertDoesNotExist()
    }

    @Test
    fun `secondary button is displayed when the action button is omitted`() {
        setTestContent {
            VowkeyTheme {
                VowkeyActionCard(
                    cardTitle = "Title",
                    secondaryButton = VowkeyButtonData(
                        label = "Learn more".asText(),
                        onClick = {},
                    ),
                )
            }
        }
        composeTestRule
            .onNodeWithText(text = "Learn more")
            .assertIsDisplayed()
    }

    @Test
    fun `content is inset from the trailing edge when the dismiss button is omitted`() {
        setTestContent {
            VowkeyTheme {
                VowkeyActionCard(
                    cardTitle = "Title",
                    cardSubtitle = "Subtitle",
                    modifier = Modifier.testTag(tag = "ActionCard"),
                )
            }
        }

        val cardRight = composeTestRule
            .onNodeWithTag(testTag = "ActionCard")
            .getUnclippedBoundsInRoot()
            .right
        val subtitleRight = composeTestRule
            .onNodeWithText(text = "Subtitle")
            .getUnclippedBoundsInRoot()
            .right
        // Without a dismiss button there is nothing else to inset the text, so the card itself
        // must keep the content 16dp away from its trailing edge.
        assertEquals(16f, (cardRight - subtitleRight).value, 0.5f)
    }
}
