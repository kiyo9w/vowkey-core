package com.vowkey.ui.platform.components.fab.model

import com.vowkey.ui.platform.components.icon.model.IconData
import com.vowkey.ui.util.Text

/**
 * Represents options displayed when the FAB is expanded.
 */
data class ExpandableFabOption(
    val label: Text,
    val icon: IconData.Local,
    val onFabOptionClick: () -> Unit,
)
