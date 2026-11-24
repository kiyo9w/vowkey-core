package com.vowkey.app.data.vault.datasource.disk

import java.io.File
import org.junit.jupiter.api.Assertions.assertArrayEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir

class AccountOriginalsTest {
    @TempDir
    lateinit var root: File

    @Test
    fun `encrypted originals stay inside the account that stored them`() {
        val first = accountOriginalFile(root, "account-a", "cipher-1", "passport")
        val second = accountOriginalFile(root, "account-b", "cipher-1", "passport")
        first.parentFile?.mkdirs()
        first.writeBytes(byteArrayOf(1, 2, 3))

        assertArrayEquals(byteArrayOf(1, 2, 3), first.readBytes())
        assertFalse(second.exists())
        assertTrue(first.path.contains("/account-a/"))
        assertFalse(first.path.contains("/account-b/"))
        File(root, "account-originals/account-a/cipher-1").deleteRecursively()
        assertNull(first.takeIf { it.exists() }?.readBytes())
    }

    @Test
    fun `path separators cannot retarget another account`() {
        assertThrows(IllegalArgumentException::class.java) {
            accountOriginalFile(root, "../account-b", "cipher-1", "passport")
        }
    }
}
